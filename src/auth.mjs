import * as oidc from 'openid-client';
import { randomBytes, createHash } from 'node:crypto';

const token = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
export function authorizeClaims(claims, tenant) {
  const o = tenant.oidc;
  if (!claims || typeof claims.sub !== 'string' || !claims.sub || claims[o.tenantClaim] !== o.tenantValue) throw new Error('IDENTITY_DENIED');
  const roles = claims[o.rolesClaim];
  if (!Array.isArray(roles) || !roles.includes(o.userRole)) throw new Error('ROLE_DENIED');
  return { tenantId: tenant.id, subject: claims.sub, admin: roles.includes(o.adminRole) };
}
export class Auth {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
    this.flows = new Map();
    this.clients = new Map();
    this.cookieName = config.demo ? 'gate_demo' : '__Host-gate';
    this.flowName = config.demo ? 'gate_demo_flow' : '__Host-gate-flow';
  }
  cookie(name, value, age) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${this.config.demo ? '' : '; Secure'}`;
  }
  readCookie(req, name) {
    const values = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
    return values.length === 1 ? values[0].slice(name.length + 1) : '';
  }
  prune() {
    const now = Date.now();
    for (const [k,v] of this.sessions) if (now >= v.expires || now - v.lastSeen >= 15 * 60_000) this.sessions.delete(k);
    for (const [k,v] of this.flows) if (now >= v.expires) this.flows.delete(k);
  }
  session(req) {
    this.prune();
    const s = this.sessions.get(digest(this.readCookie(req, this.cookieName)));
    if (s) s.lastSeen = Date.now();
    return s;
  }
  createSession(identity, req, lifetime = 60 * 60_000) {
    this.prune();
    if (this.sessions.size >= 10000) throw new Error('SESSION_CAPACITY');
    this.sessions.delete(digest(this.readCookie(req, this.cookieName)));
    const value = token();
    const session = { ...identity, csrf: token(), expires: Date.now() + lifetime, lastSeen: Date.now() };
    this.sessions.set(digest(value), session);
    return { session, cookie: this.cookie(this.cookieName, value, Math.floor(lifetime / 1000)) };
  }
  logout(req) {
    this.sessions.delete(digest(this.readCookie(req, this.cookieName)));
    return this.cookie(this.cookieName, '', 0);
  }
  async client(tenant) {
    if (!this.clients.has(tenant.id)) {
      const pending = oidc.discovery(new URL(tenant.oidc.issuer), tenant.oidc.clientId,
        tenant.oidc.clientSecret, undefined, { execute: [oidc.enableNonRepudiationChecks], timeout: 10 });
      this.clients.set(tenant.id, pending);
      pending.catch(() => this.clients.delete(tenant.id));
    }
    return this.clients.get(tenant.id);
  }
  async login(tenant) {
    this.prune();
    if (this.flows.size >= 2000) throw new Error('LOGIN_CAPACITY');
    const client = await this.client(tenant);
    const state = token(), nonce = token(), browser = token();
    const verifier = oidc.randomPKCECodeVerifier();
    this.flows.set(state, { tenantId: tenant.id, nonce, verifier, browser: digest(browser), expires: Date.now() + 5 * 60_000 });
    const redirect = oidc.buildAuthorizationUrl(client, {
      redirect_uri: `${this.config.origin}/auth/callback`, scope: 'openid profile',
      state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256'
    });
    return { redirect: redirect.href, cookie: this.cookie(this.flowName, browser, 300) };
  }
  async callback(url, req) {
    this.prune();
    const state = url.searchParams.get('state');
    const flow = this.flows.get(state);
    this.flows.delete(state); // Single use, including failed exchanges.
    if (!flow || digest(this.readCookie(req, this.flowName)) !== flow.browser) throw new Error('LOGIN_STATE_DENIED');
    const tenant = this.config.tenants.find(t => t.id === flow.tenantId);
    const client = await this.client(tenant);
    const tokens = await oidc.authorizationCodeGrant(client, url, {
      pkceCodeVerifier: flow.verifier, expectedState: state, expectedNonce: flow.nonce, idTokenExpected: true
    });
    const claims = tokens.claims();
    const identity = authorizeClaims(claims, tenant);
    const lifetime = Math.min(60 * 60_000, claims.exp * 1000 - Date.now());
    if (!Number.isFinite(lifetime) || lifetime < 1000) throw new Error('TOKEN_EXPIRED');
    return { identity, lifetime, clearFlow: this.cookie(this.flowName, '', 0) };
  }
}
