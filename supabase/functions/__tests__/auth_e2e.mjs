// Every edge function, run for real under Deno against a fake Supabase that
// records each call it receives. Checks that nobody gets in without a verified
// session (no token, the public app key, a forged token), that a user id in
// the request is never taken as identity, and that only the server can sweep.
//
// Run: npm run test:functions   (needs Deno; nothing touches your project)
import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A copy of the functions with a deno.json that ignores the app's node_modules.
const FN_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'niblgo-fn-'));
fs.cpSync(FN_DIR, path.join(WORK, 'functions'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'deno.json'), '{"nodeModulesDir":"none"}');
const ATTACKER = 'dddddddd-0000-4000-8000-000000000004';
const VICTIM = 'aaaaaaaa-0000-4000-8000-000000000001';
const SERVICE = 'service-role-secret-value';
const FAKE_SWEEP = 'x'.repeat(40); // a stand-in, long enough to be accepted
let calls = [];
const fake = http.createServer((q, r) => {
  let body = ''; q.on('data', (c) => (body += c)); q.on('end', () => {
    calls.push({ m: q.method, u: q.url, auth: q.headers.authorization || '' });
    const send = (code, obj) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(obj)); };
    if (q.url.startsWith('/auth/v1/user')) {
      return q.headers.authorization === 'Bearer attacker-session'
        ? send(200, { id: ATTACKER, aud: 'authenticated', role: 'authenticated', email: 'm@x.co' })
        : send(401, { code: 401, msg: 'invalid JWT' });
    }
    if (q.url.startsWith('/rest/v1/rpc/consume_ai_quota')) return send(200, false); // stop before any AI spend
    if (q.url.startsWith('/storage/v1/object/list')) return send(200, []);
    send(200, q.url.startsWith('/rest/v1/rpc/') ? null : []);
  });
}).listen(54329);

const forged = (() => { // a JWT for the victim, signed with the wrong key
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: VICTIM, role: 'service_role', aud: 'authenticated', exp: 9999999999 })}.${'x'.repeat(43)}`;
})();
const FNS = ['format-recipe', 'lookup-nutrition', 'delete-account', 'upload-photo', 'notify-message', 'notify-activity', 'sweep-storage'];
const bodyFor = (fn) => ({
  'format-recipe': { blurb: 'chicken thing', user_id: VICTIM },
  'lookup-nutrition': { ingredients: [{ item: 'garlic', quantity: '2', unit: 'cloves' }], user_id: VICTIM },
  'delete-account': { user_id: VICTIM, userId: VICTIM },
  'upload-photo': null,
  'notify-message': { conversationId: '20000000-0000-4000-8000-000000000001', messageId: '30000000-0000-4000-8000-000000000001', senderId: VICTIM },
  'notify-activity': { actor_id: VICTIM },
  'sweep-storage': { grace_hours: 0 },
}[fn]);
let failed = 0;
const check = (n, ok, d = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [i, fn] of FNS.entries()) {
  const port = 8100 + i;
  const p = spawn('deno', ['run', '--allow-net=localhost,127.0.0.1,0.0.0.0', '--allow-env', '--config', path.join(WORK, 'deno.json'), path.join(WORK, 'functions', fn, 'index.ts')], {
    env: { ...process.env, SUPABASE_URL: 'http://localhost:54329', SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: SERVICE, ANTHROPIC_API_KEY: 'sk-ant-test', USDA_API_KEY: 'usda-test', SWEEP_SECRET: FAKE_SWEEP, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  for (let t = 0; t < 100 && !/Listening on/.test(log); t++) await sleep(100);
  const m = log.match(/Listening on https?:\/\/[^:]+:(\d+)/); const base = `http://127.0.0.1:${m ? m[1] : 8000}`;
  const hit = async (auth, method = 'POST') => {
    calls = [];
    const headers = { 'content-type': 'application/json', ...(auth ? { Authorization: auth } : {}) };
    if (fn === 'upload-photo') Object.assign(headers, { 'x-photo-kind': 'post', 'content-type': 'image/jpeg' });
    const r = await fetch(base, { method, headers, body: method === 'POST' ? (fn === 'upload-photo' ? new Uint8Array([0xff, 0xd8]) : JSON.stringify(bodyFor(fn))) : undefined });
    await r.text(); return { status: r.status, calls };
  };
  const writes = (c) => c.calls.filter((x) => !x.u.startsWith('/auth/v1/user'));
  for (const [label, auth] of [['no token', null], ['the public app key', 'Bearer sb_publishable_test'], ['a forged token naming the victim', `Bearer ${forged}`]]) {
    const r = await hit(auth);
    check(`${fn}: ${label} is refused, and nothing is touched`, (r.status === 401 || r.status === 403) && writes(r).length === 0, `${r.status}, ${writes(r).length} backend calls`);
  }
  if (fn === 'sweep-storage') {
    const r = await hit('Bearer attacker-session');
    check(`${fn}: a signed-in user is not the server`, (r.status === 401 || r.status === 403) && writes(r).length === 0, String(r.status));
    calls = [];
    const g = await fetch(base, { method: 'POST', headers: { 'x-sweep-secret': FAKE_SWEEP }, body: '{}' });
    check(`${fn}: the sweep secret runs it`, g.status === 200 && calls.some((x) => x.u.startsWith('/rest/v1/rpc/storage_orphans')), String(g.status));
    calls = [];
    const s2 = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${SERVICE}` }, body: '{}' });
    check(`${fn}: the service-role key still runs it`, s2.status === 200, String(s2.status));
  } else {
    const r = await hit('Bearer attacker-session');
    const victimTouched = r.calls.some((x) => x.u.includes(VICTIM));
    check(`${fn}: a user id in the request is ignored (only the session counts)`, !victimTouched, `${r.status}; ${r.calls.map((x) => x.m + ' ' + x.u.split('?')[0]).join(', ')}`);
    if (fn === 'delete-account') check(`${fn}: deletes the caller, never the named user`, r.calls.some((x) => x.m === 'DELETE' && x.u.includes(ATTACKER)) && !victimTouched);
  }
  const g = await hit(null, 'GET');
  check(`${fn}: GET is refused`, g.status >= 400 && writes(g).length === 0, String(g.status));
  p.kill(); await sleep(400);
}
fake.close();
fs.rmSync(WORK, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0);
