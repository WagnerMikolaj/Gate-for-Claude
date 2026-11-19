import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const envName = /^[A-Z][A-Z0-9_]{1,99}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireValue(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`);
  return value;
}
export function validateTenants(tenants, env, allowExternal) {
  if (!Array.isArray(tenants) || !tenants.length || tenants.length > 100) throw new Error('Invalid tenant registry');
  const ids = new Set();
  const bindings = new Set();
  const secrets = new Set();
  const providerKeys = new Set();
  return tenants.map(t => {
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(t.id) || ids.has(t.id)) throw new Error('Invalid/duplicate tenant ID');
    ids.add(t.id);
    requireValue(t.name, 'tenant name');
    const o = t.oidc;
    if (!o) throw new Error('OIDC required');
    const issuer = new URL(o.issuer);
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash || /\/(common|organizations|consumers)(\/|$)/i.test(issuer.pathname)) throw new Error('Use a pinned HTTPS issuer per tenant');
    for (const k of ['clientId', 'tenantClaim', 'tenantValue', 'rolesClaim', 'userRole', 'adminRole']) requireValue(o[k], `oidc.${k}`);
    if (o.clientId.startsWith('replace-')) throw new Error('Replace example OIDC client IDs');
    const binding = `${issuer.href}|${o.tenantClaim}|${o.tenantValue}`;
    if (bindings.has(binding)) throw new Error('Identity tenant is mapped more than once');
    bindings.add(binding);
    if (!envName.test(o.clientSecretEnv)) throw new Error('Invalid secret reference');
    const clientSecret = requireValue(env[o.clientSecretEnv], o.clientSecretEnv);
    if (secrets.has(clientSecret)) throw new Error('OIDC secrets must be separate per tenant');
    secrets.add(clientSecret);
    const p = t.provider;
    if (!p || !envName.test(p.apiKeyEnv) || !Array.isArray(p.orgIds) || !p.orgIds.length || p.orgIds.length > 20 || !p.orgIds.every(x => uuid.test(x)) || !/^claude-[a-z0-9.-]{1,100}$/.test(p.model)) throw new Error('Invalid provider configuration');
    const apiKey = allowExternal ? requireValue(env[p.apiKeyEnv], p.apiKeyEnv) : undefined;
    if (apiKey && providerKeys.has(apiKey)) throw new Error('Provider keys must be separate per tenant');
    if (apiKey) providerKeys.add(apiKey);
    const policy = t.policy;
    if (!policy || !Array.isArray(policy.blockedTerms) || policy.blockedTerms.length > 100 || !policy.blockedTerms.every(x => typeof x === 'string' && x.trim().length >= 3 && x.length <= 200) || !Number.isInteger(policy.requestsPerMinute) || policy.requestsPerMinute < 1 || policy.requestsPerMinute > 120) throw new Error('Invalid DLP/rate policy');
    return { ...t, oidc: { ...o, clientSecret }, provider: { ...p, apiKey } };
  });
}
export function loadConfig(env = process.env, demo = false) {
  const port = Number(env.GATE_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  if (demo) return {
    demo: true, host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}`,
    allowExternal: false, auditKey: randomBytes(32).toString('hex'), auditDb: ':memory:',
    tenants: ['acme', 'beta'].map(id => ({ id, name: id.toUpperCase(), policy: { blockedTerms: ['poufne', 'confidential', 'projekt orion'], requestsPerMinute: 10 } }))
  };
  const url = new URL(requireValue(env.GATE_ORIGIN, 'GATE_ORIGIN'));
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Production origin must be an HTTPS origin');
  if (!env.GATE_AUDIT_KEY || !/^[0-9a-f]{64,}$/i.test(env.GATE_AUDIT_KEY)) throw new Error('Audit key requires at least 32 random bytes as hex');
  const allowExternal = env.GATE_ALLOW_EXTERNAL_AI === 'true';
  const { tenants } = JSON.parse(readFileSync(requireValue(env.GATE_TENANTS_FILE, 'GATE_TENANTS_FILE'), 'utf8'));
  return { demo: false, host: env.GATE_HOST || '127.0.0.1', port, origin: url.origin, allowExternal,
    auditKey: env.GATE_AUDIT_KEY, auditDb: env.GATE_AUDIT_DB || './data/audit.db', tenants: validateTenants(tenants, env, allowExternal) };
}
