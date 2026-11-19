import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Auth } from './auth.mjs';
import { Audit } from './audit.mjs';
import { inspect, inspectMessages, validateMessages } from './dlp.mjs';
import { sendToClaude } from './provider.mjs';

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; } }
const assets = new Map([
  ['/', ['text/html; charset=utf-8', readFileSync(new URL('../public/index.html', import.meta.url))]],
  ['/app.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/app.js', import.meta.url))]],
  ['/styles.css', ['text/css; charset=utf-8', readFileSync(new URL('../public/styles.css', import.meta.url))]]
]);
class Limiter {
  constructor() { this.entries = new Map(); }
  take(key, limit) {
    const now = Date.now();
    if (this.entries.size > 10000) for (const [k,v] of this.entries) if (v.until <= now) this.entries.delete(k);
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now) {
      if (this.entries.size >= 20000) return false;
      entry = { count: 0, until: now + 60000 }; this.entries.set(key, entry);
    }
    return ++entry.count <= limit;
  }
}
async function body(req) {
  if (req.headers['content-encoding'] || req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, 'JSON_REQUIRED');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64000) throw new HttpError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'INVALID_JSON'); }
}
export function createGate(config, deps = {}) {
  const auth = deps.auth || new Auth(config);
  const audit = deps.audit || new Audit(config.auditDb, config.auditKey);
  const provider = deps.provider || sendToClaude;
  const limiter = new Limiter();
  const inFlight = new Set();
  const server = http.createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (!config.demo) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const record = (session, decision, categories) => audit.record({ tenant: session.tenantId, subject: session.subject, requestId, decision, categories });
    try {
      // Host/Origin are validated against operator configuration. Forwarded identity headers are ignored.
      if (req.headers.host !== new URL(config.origin).host) throw new HttpError(421, 'HOST_DENIED');
      if (!limiter.take(`ip:${req.socket.remoteAddress}`, 600)) throw new HttpError(429, 'RATE_LIMIT');
      const url = new URL(req.url, config.origin);
      if (url.origin !== config.origin) throw new HttpError(400, 'URL_DENIED');
      if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'METHOD_DENIED');
      if (req.method === 'POST' && req.headers.origin !== config.origin) throw new HttpError(403, 'ORIGIN_DENIED');
      if (req.method === 'GET' && url.pathname === '/healthz') return json(200, { status: 'ok' });
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [type, content] = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': type }); return res.end(content);
      }
      if (req.method === 'GET' && url.pathname === '/api/bootstrap') return json(200, {
        demo: config.demo, tenants: config.tenants.map(t => ({ id: t.id, name: t.name }))
      });
      if (req.method === 'GET' && url.pathname.startsWith('/auth/login/')) {
        if (config.demo) throw new HttpError(400, 'DEMO_LOGIN_ONLY');
        if (!limiter.take(`login:${req.socket.remoteAddress}`, 20)) throw new HttpError(429, 'RATE_LIMIT');
        const tenant = config.tenants.find(t => t.id === url.pathname.slice('/auth/login/'.length));
        if (!tenant) throw new HttpError(404, 'TENANT_UNKNOWN');
        const flow = await auth.login(tenant);
        res.writeHead(302, { Location: flow.redirect, 'Set-Cookie': flow.cookie }); return res.end();
      }
      if (req.method === 'POST' && url.pathname.startsWith('/auth/demo/')) {
        if (!config.demo || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw new HttpError(403, 'DEMO_DISABLED');
        const tenant = config.tenants.find(t => t.id === url.pathname.slice('/auth/demo/'.length));
        if (!tenant) throw new HttpError(404, 'TENANT_UNKNOWN');
        const identity = { tenantId: tenant.id, subject: 'synthetic-demo-user', admin: true };
        record(identity, 'DEMO_LOGIN');
        res.setHeader('Set-Cookie', auth.createSession(identity, req).cookie);
        return json(200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        if (config.demo) throw new HttpError(403, 'DEMO_DISABLED');
        try {
          const result = await auth.callback(url, req);
          record(result.identity, 'LOGIN_ALLOWED');
          const session = auth.createSession(result.identity, req, result.lifetime);
          res.writeHead(302, { Location: '/', 'Set-Cookie': [session.cookie, result.clearFlow] }); return res.end();
        } catch {
          audit.record({ tenant: '_system', requestId, decision: 'LOGIN_DENIED' });
          throw new HttpError(403, 'LOGIN_DENIED');
        }
      }
      const session = auth.session(req);
      if (!session) throw new HttpError(401, 'LOGIN_REQUIRED');
      const tenant = config.tenants.find(t => t.id === session.tenantId);
      if (!tenant) throw new HttpError(403, 'TENANT_DENIED');
      if (req.method === 'POST' && req.headers['x-csrf-token'] !== session.csrf) throw new HttpError(403, 'CSRF_DENIED');
      if (req.method === 'GET' && url.pathname === '/api/session') return json(200, {
        tenant: { id: tenant.id, name: tenant.name }, csrf: session.csrf, admin: session.admin,
        demo: config.demo, externalEnabled: config.allowExternal && !config.demo,
        policy: { textOnly: true, requestsPerMinute: tenant.policy.requestsPerMinute,
          detectors: ['PESEL', 'PAYMENT_CARD', 'IBAN', 'EMAIL', 'PERSONAL_NUMBER', 'SECRET', 'CONFIDENTIAL_LABEL', 'OPAQUE_ENCODING'] }
      });
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        record(session, 'LOGOUT'); res.setHeader('Set-Cookie', auth.logout(req)); return json(200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if (!session.admin) throw new HttpError(403, 'ADMIN_REQUIRED');
        return json(200, { events: audit.list(tenant.id) });
      }
      if (req.method === 'POST' && ['/api/check', '/api/chat'].includes(url.pathname)) {
        if (!limiter.take(`user:${tenant.id}:${session.subject}`, tenant.policy.requestsPerMinute)) throw new HttpError(429, 'RATE_LIMIT');
        let messages;
        try { messages = validateMessages(await body(req)); }
        catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'INVALID_MESSAGES'); }
        const result = inspectMessages(messages, tenant.policy);
        if (!result.allowed) {
          record(session, 'DLP_BLOCKED', result.categories);
          return json(422, { code: 'DLP_BLOCKED', categories: result.categories, requestId });
        }
        if (url.pathname === '/api/check') {
          record(session, 'CHECK_PASSED'); return json(200, { code: 'CHECK_PASSED', requestId });
        }
        if (config.demo || !config.allowExternal) {
          record(session, 'EGRESS_DISABLED'); throw new HttpError(503, 'EGRESS_DISABLED');
        }
        const slot = `${tenant.id}:${session.subject}`;
        if (inFlight.has(slot) || inFlight.size >= 100) throw new HttpError(429, 'CONCURRENT_LIMIT');
        inFlight.add(slot);
        try {
          // Audit must be durably committed BEFORE outbound data transfer.
          record(session, 'FORWARD_AUTHORIZED');
          let reply;
          try { reply = await provider(tenant, messages); }
          catch { record(session, 'PROVIDER_FAILED'); throw new HttpError(502, 'PROVIDER_FAILED'); }
          const responseCheck = inspect(reply, tenant.policy);
          if (!responseCheck.allowed) {
            record(session, 'RESPONSE_BLOCKED', responseCheck.categories);
            return json(422, { code: 'RESPONSE_BLOCKED', categories: responseCheck.categories, requestId });
          }
          record(session, 'REPLY_DELIVERED');
          return json(200, { reply, requestId });
        } finally { inFlight.delete(slot); }
      }
      throw new HttpError(404, 'NOT_FOUND');
    } catch (error) {
      if (!res.headersSent) json(error instanceof HttpError ? error.status : 503, { code: error instanceof HttpError ? error.message : 'GATE_UNAVAILABLE', requestId });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return { server, auth, audit };
}
