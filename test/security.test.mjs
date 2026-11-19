import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import * as oidc from 'openid-client';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, validateTenants } from '../src/config.mjs';
import { inspect, inspectMessages, validateMessages } from '../src/dlp.mjs';
import { Audit } from '../src/audit.mjs';
import { Auth, authorizeClaims } from '../src/auth.mjs';
import { createGate } from '../src/server.mjs';
import { sendToClaude } from '../src/provider.mjs';

const policy = { blockedTerms: ['poufne', 'confidential'], requestsPerMinute: 100 };
const tenant = { id:'acme', name:'ACME', oidc: { issuer:'https://issuer.acme.test', clientId:'gate-acme', clientSecret:'secret', tenantClaim:'tid', tenantValue:'acme-idp', rolesClaim:'roles', userRole:'Gate.User', adminRole:'Gate.Admin' }, policy,
  provider:{ apiKey:'corporate-key', orgIds:['22222222-2222-4222-8222-222222222222'], model:'claude-sonnet-4-6' } };
test('production configuration refuses missing settings, wildcard issuer, duplicate identities and shared keys', () => {
  assert.throws(() => loadConfig({}));
  const examples = JSON.parse(readFileSync(new URL('../config/tenants.example.json', import.meta.url)));
  const tenants = examples.tenants.map((t,i) => ({ ...t, oidc: { ...t.oidc, clientId:`client-${i}` } }));
  const env = { ACME_OIDC_SECRET:'first-secret', BETA_OIDC_SECRET:'second-secret', ACME_ANTHROPIC_KEY:'first-key', BETA_ANTHROPIC_KEY:'second-key' };
  assert.equal(validateTenants(tenants, env, true).length, 2);
  assert.throws(() => validateTenants(tenants, { ...env, BETA_ANTHROPIC_KEY:'first-key' }, true));
  assert.throws(() => validateTenants([tenants[0], { ...tenants[1], oidc:tenants[0].oidc }], env, true));
  assert.throws(() => validateTenants([{...tenants[0], oidc:{ ...tenants[0].oidc, issuer:'https://login.microsoftonline.com/common/v2.0' }}], env, true));
  const demo = loadConfig({ GATE_HOST:'0.0.0.0', GATE_ALLOW_EXTERNAL_AI:'true' }, true);
  assert.equal(demo.host, '127.0.0.1'); assert.equal(demo.allowExternal, false);
});
for (const [name, value, category] of [
  ['PESEL', '55030101193', 'PESEL'],
  ['credit card', '4111 1111 1111 1111', 'PAYMENT_CARD'],
  ['IBAN', 'PL61109010140000071219812874', 'IBAN'],
  ['email', 'employee@example.test', 'EMAIL'],
  ['telephone', '+48 123 456 789', 'PERSONAL_NUMBER'],
  ['secret', 'api_key=sample-secret-value', 'SECRET'],
  ['private key', '-----BEGIN RSA PRIVATE KEY-----', 'SECRET'],
  ['classification', 'Dane POUFNE dla zarządu', 'CONFIDENTIAL_LABEL'],
  ['zero-width classification', 'pou\u200bfne', 'CONFIDENTIAL_LABEL'],
  ['full-width secret', 'ａｐｉ＿ｋｅｙ=sample-secret', 'SECRET'],
  ['opaque encoded content', 'A'.repeat(100), 'OPAQUE_ENCODING']
]) test(`DLP blocks ${name} without returning the sensitive value`, () => {
  const result = inspect(value, policy);
  assert.equal(result.allowed, false); assert.ok(result.categories.includes(category));
  assert.equal(JSON.stringify(result).includes(value), false);
});
test('DLP allows ordinary text and checks previous assistant messages and split secrets', () => {
  assert.deepEqual(inspect('Wyjaśnij zasadę działania kolejki zadań.', policy), { allowed:true, categories:[] });
  assert.equal(inspectMessages([{role:'user', content:'Temat'}, {role:'assistant', content:'confidential'}, {role:'user',content:'Kontynuuj'}], policy).allowed, false);
  assert.equal(inspectMessages([{role:'user', content:'api_'}, {role:'assistant', content:'key=sample-secret'}, {role:'user',content:'dalej'}], policy).allowed, false);
});
test('strict request schema rejects tenant/key/URL overrides, attachments, tools and invalid history', () => {
  const messages = [{role:'user', content:'Witaj'}];
  for (const override of ['tenant','tenantId','model','api_key','tools','system','url']) assert.throws(() => validateMessages({messages, [override]:'evil'}));
  for (const invalid of [[{role:'user',content:[{type:'image',source:'data'}]}], [{role:'assistant',content:'x'}], [{role:'user',content:'x',attachments:[]}], [{role:'user',content:'x'},{role:'user',content:'y'}]]) assert.throws(() => validateMessages({messages:invalid}));
});
test('signed identity must belong to selected tenant and have enterprise role; email grants nothing', () => {
  assert.throws(() => authorizeClaims({sub:'user',tid:'other',roles:['Gate.User']},tenant));
  assert.throws(() => authorizeClaims({sub:'user',tid:'acme-idp',email:'ceo@acme.test'},tenant));
  assert.throws(() => authorizeClaims({sub:'user',tid:'acme-idp',roles:['Gate.Admin']},tenant));
  assert.equal(authorizeClaims({sub:'user',tid:'acme-idp',roles:['Gate.User']},tenant).admin,false);
});

const keys = generateKeyPairSync('rsa', { modulusLength:2048 });
const publicJwk = { ...keys.publicKey.export({format:'jwk'}), kid:'key-one', alg:'RS256', use:'sig' };
function jwt(claims, signingKey = keys.privateKey) {
  const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  const input = `${encode({alg:'RS256',kid:'key-one'})}.${encode(claims)}`;
  return `${input}.${sign('sha256',Buffer.from(input),signingKey).toString('base64url')}`;
}
async function oidcFlow(overrides = {}, wrongKey = false) {
  const config = { demo:false, origin:'https://gate.test', tenants:[tenant] };
  const auth = new Auth(config);
  const client = new oidc.Configuration({ issuer:tenant.oidc.issuer, authorization_endpoint:`${tenant.oidc.issuer}/authorize`, token_endpoint:`${tenant.oidc.issuer}/token`, jwks_uri:`${tenant.oidc.issuer}/jwks`, token_endpoint_auth_methods_supported:['client_secret_post'], id_token_signing_alg_values_supported:['RS256'], response_types_supported:['code'] }, tenant.oidc.clientId, tenant.oidc.clientSecret);
  let nonce;
  client[oidc.customFetch] = async url => {
    if (String(url).endsWith('/jwks')) return Response.json({keys:[publicJwk]});
    const now = Math.floor(Date.now()/1000);
    const claims = { iss:tenant.oidc.issuer, aud:tenant.oidc.clientId, sub:'corporate-user', tid:'acme-idp', roles:['Gate.User'], iat:now, exp:now+3600, nonce, ...overrides };
    const signingKey = wrongKey ? generateKeyPairSync('rsa',{modulusLength:2048}).privateKey : keys.privateKey;
    return Response.json({access_token:'unused',token_type:'Bearer',expires_in:3600,id_token:jwt(claims,signingKey)});
  };
  oidc.enableNonRepudiationChecks(client);
  auth.clients.set('acme', Promise.resolve(client));
  const login = await auth.login(tenant);
  const redirect = new URL(login.redirect); nonce = redirect.searchParams.get('nonce');
  assert.equal(redirect.searchParams.get('code_challenge_method'),'S256');
  const callback = new URL(`https://gate.test/auth/callback?code=code&state=${redirect.searchParams.get('state')}`);
  const req = {headers:{cookie:login.cookie.split(';')[0]}};
  return { auth, callback, req };
}
test('OIDC real JWT verification succeeds with state + nonce + PKCE and callback is single-use', async () => {
  const {auth,callback,req} = await oidcFlow();
  const result = await auth.callback(callback,req);
  assert.equal(result.identity.tenantId,'acme');
  await assert.rejects(auth.callback(callback,req));
});
for (const [name, claims, wrongKey] of [
  ['wrong issuer',{iss:'https://attacker.test'}], ['wrong audience',{aud:'other-app'}],
  ['expired token',{exp:1}], ['wrong nonce',{nonce:'wrong'}], ['wrong tenant',{tid:'beta-idp'}],
  ['missing corporate role',{roles:[]}], ['invalid signature',{},true]
]) test(`OIDC rejects ${name}`, async () => {
  const {auth,callback,req} = await oidcFlow(claims,wrongKey);
  await assert.rejects(auth.callback(callback,req));
});
test('OIDC callback is browser-bound and refuses state guessing', async () => {
  let flow = await oidcFlow();
  await assert.rejects(flow.auth.callback(flow.callback,{headers:{cookie:'__Host-gate-flow=guessed'}}));
  flow = await oidcFlow(); flow.callback.searchParams.set('state','guessed');
  await assert.rejects(flow.auth.callback(flow.callback,flow.req));
});
test('session expires and cannot be forged with forwarded identity headers', () => {
  const auth = new Auth({demo:false});
  const created = auth.createSession({tenantId:'acme',subject:'u',admin:false},{headers:{}});
  const req = {headers:{cookie:created.cookie.split(';')[0]}};
  assert.equal(auth.session(req).tenantId,'acme');
  assert.match(created.cookie,/__Host-gate=.*Secure/);
  created.session.lastSeen = Date.now()-16*60000;
  assert.equal(auth.session(req),undefined);
  assert.equal(auth.session({headers:{'x-forwarded-user':'admin','x-tenant-id':'acme'}}),undefined);
});
test('audit persists metadata only, partitions by tenant and detects tampering at restart', () => {
  const dir = mkdtempSync(join(tmpdir(),'gate-audit-'));
  const path = join(dir,'audit.db'); const key = 'a'.repeat(64);
  try {
    let audit = new Audit(path,key);
    audit.record({tenant:'acme',subject:'employee@example.test',requestId:'one',decision:'DLP_BLOCKED',categories:['EMAIL'],prompt:'secret-content'});
    audit.record({tenant:'beta',subject:'other',requestId:'two',decision:'CHECK_PASSED'});
    assert.equal(audit.list('acme').length,1);
    assert.equal(JSON.stringify(audit.list('acme')).includes('employee@example.test'),false);
    assert.equal(JSON.stringify(audit.list('acme')).includes('secret-content'),false);
    audit.close(); audit = new Audit(path,key); audit.close();
    const db = new DatabaseSync(path); db.exec("UPDATE events SET tenant='beta' WHERE id=1"); db.close();
    assert.throws(() => new Audit(path,key),/integrity/);
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir,{recursive:true,force:true});
  }
});

async function fixture(t, overrides = {}, providerOverride) {
  const config = { ...loadConfig({},true), tenants:[tenant,{...tenant,id:'beta',name:'BETA'}], ...overrides };
  const calls = [];
  const gate = createGate(config,{provider:async (...args)=>{calls.push(args);return providerOverride ? providerOverride(...args) : 'Bezpieczna odpowiedź.';}});
  await new Promise(resolve => gate.server.listen(0,'127.0.0.1',resolve));
  config.origin = `http://127.0.0.1:${gate.server.address().port}`;
  t.after(async () => { await new Promise(resolve=>gate.server.close(resolve)); gate.audit.close(); });
  const makeSession = (tenantId='acme',admin=true) => {
    const result = gate.auth.createSession({tenantId,subject:`${tenantId}-user`,admin},{headers:{}});
    return {cookie:result.cookie.split(';')[0],csrf:result.session.csrf};
  };
  const request = async (path,{login,body,origin=config.origin,headers={},method}={}) => {
    const response = await fetch(config.origin+path,{method:method || (body === undefined ? 'GET':'POST'), headers:{...(login ? {Cookie:login.cookie,'X-CSRF-Token':login.csrf}:{}),...(body === undefined ? {} : {'Content-Type':'application/json',Origin:origin}),...headers},body:body === undefined ? undefined : JSON.stringify(body)});
    const data = await response.json(); return {status:response.status,data,headers:response.headers};
  };
  return {gate,calls,request,makeSession,config};
}
const safeBody = {messages:[{role:'user',content:'Wyjaśnij wzorzec kolejki zadań.'}]};
test('HTTP: no auth, forged identity, cross-origin and missing CSRF cannot forward data', async t => {
  const f = await fixture(t,{demo:false,allowExternal:true});
  assert.equal((await f.request('/api/chat',{body:safeBody})).status,401);
  assert.equal((await f.request('/api/chat',{body:safeBody,headers:{'X-Forwarded-User':'admin','X-Tenant-Id':'acme'}})).status,401);
  const login = f.makeSession();
  assert.equal((await f.request('/api/chat',{login,body:safeBody,origin:'https://attacker.test'})).status,403);
  assert.equal((await f.request('/api/chat',{login,body:safeBody,headers:{'X-CSRF-Token':'wrong'}})).status,403);
  const hostStatus = await new Promise((resolve,reject) => {
    const req = http.request(f.config.origin + '/api/session', {headers:{Host:'attacker.test',Cookie:login.cookie}}, res => {res.resume();resolve(res.statusCode);});
    req.on('error',reject); req.end();
  });
  assert.equal(hostStatus,421);
  assert.equal(f.calls.length,0);
});
test('HTTP: DLP blocks before provider; clean messages use session tenant and server credentials only', async t => {
  const f = await fixture(t,{demo:false,allowExternal:true}); const login = f.makeSession();
  const blocked = await f.request('/api/chat',{login,body:{messages:[{role:'user',content:'employee@example.test'}]}});
  assert.equal(blocked.status,422); assert.equal(f.calls.length,0);
  assert.equal(JSON.stringify(blocked.data).includes('employee@example.test'),false);
  assert.equal((await f.request('/api/chat',{login,body:{...safeBody,tenantId:'beta'}})).status,400);
  const allowed = await f.request('/api/chat',{login,body:safeBody});
  assert.equal(allowed.status,200); assert.equal(f.calls.length,1); assert.equal(f.calls[0][0].id,'acme');
});
test('HTTP: demo and disabled egress never call provider even for safe messages', async t => {
  for (const overrides of [{demo:true,allowExternal:true},{demo:false,allowExternal:false}]) {
    const f = await fixture(t,overrides); const login = f.makeSession();
    assert.equal((await f.request('/api/chat',{login,body:safeBody})).data.code,'EGRESS_DISABLED'); assert.equal(f.calls.length,0);
  }
});
test('HTTP: tenant audit cannot be selected by query and normal users cannot read it', async t => {
  const f = await fixture(t); const a = f.makeSession('acme'); const b = f.makeSession('beta');
  await f.request('/api/check',{login:a,body:safeBody});
  const data = await f.request('/api/events?tenant=acme',{login:b}); assert.deepEqual(data.data.events,[]);
  assert.equal((await f.request('/api/events',{login:f.makeSession('acme',false)})).status,403);
  assert.equal((await f.request('/api/events',{login:a})).data.events.length,1);
});
test('HTTP: audit write failure blocks provider', async t => {
  const f = await fixture(t,{demo:false,allowExternal:true}); const login = f.makeSession();
  const original = f.gate.audit.record.bind(f.gate.audit);
  f.gate.audit.record = () => {throw new Error('disk full');};
  assert.equal((await f.request('/api/chat',{login,body:safeBody})).status,503); assert.equal(f.calls.length,0);
  f.gate.audit.record = original;
});
test('HTTP: response DLP and upstream errors never expose raw data', async t => {
  let f = await fixture(t,{demo:false,allowExternal:true},async ()=>'employee@example.test');
  let result = await f.request('/api/chat',{login:f.makeSession(),body:safeBody});
  assert.equal(result.data.code,'RESPONSE_BLOCKED'); assert.equal(JSON.stringify(result.data).includes('employee@example.test'),false);
  f = await fixture(t,{demo:false,allowExternal:true},async ()=>{throw new Error('secret-key-in-provider-error');});
  result = await f.request('/api/chat',{login:f.makeSession(),body:safeBody});
  assert.equal(result.status,502); assert.equal(JSON.stringify(result.data).includes('secret-key'),false);
});
test('HTTP: per-tenant per-user rate limit and logout revocation', async t => {
  const f = await fixture(t,{tenants:[{...tenant,policy:{...policy,requestsPerMinute:1}}]}); const login = f.makeSession();
  assert.equal((await f.request('/api/check',{login,body:safeBody})).status,200);
  assert.equal((await f.request('/api/check',{login,body:safeBody})).status,429);
  assert.equal((await f.request('/auth/logout',{login,body:{}})).status,200);
  assert.equal((await f.request('/api/session',{login})).status,401);
});
test('provider fixes destination, org, key and model and refuses redirects/error bodies', async () => {
  await sendToClaude(tenant,safeBody.messages,async (url,options) => {
    assert.equal(url,'https://api.anthropic.com/v1/messages'); assert.equal(options.redirect,'error');
    assert.equal(options.headers['x-api-key'],'corporate-key'); assert.equal(options.headers['anthropic-allowed-org-ids'],tenant.provider.orgIds[0]);
    assert.equal(JSON.parse(options.body).model,tenant.provider.model);
    return Response.json({content:[{type:'text',text:'Witaj'}]});
  });
  await assert.rejects(sendToClaude(tenant,safeBody.messages,async()=>new Response('secret upstream body',{status:403})), {message:'PROVIDER_FAILURE'});
});
