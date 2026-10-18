// The front door for the end-to-end test (run.sh): one HTTPS address that
// routes like a Supabase project does.
//
//   /auth/v1/*        -> the real Supabase Auth server
//   /rest/v1/*        -> the real PostgREST server
//   /functions/v1/:fn -> the real edge function, behind the same JWT check
//                        Supabase's gateway does (every function except
//                        sweep-storage, which is deployed --no-verify-jwt)
//   /storage/v1/*     -> a stand-in for Supabase Storage (below)
//   /__fakes/:host/*  -> stand-ins for Anthropic, USDA and Expo push, which
//                        count what they're asked so the test can check it
//
// Storage stand-in. The real Storage API checks who may read, write or sign a
// file by querying storage.objects in Postgres as the caller: it verifies the
// token, switches to its role, sets request.jwt.claims, and lets the bucket
// policies (RLS) decide. This does the same, through the same policies; it
// keeps the bytes in memory and enforces each bucket's size and type limits.
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';

const require = createRequire(import.meta.url);
const pg = require('pg');

const SECRET = process.env.E2E_JWT_SECRET;
const REST = new URL(process.env.E2E_REST);
const AUTH = new URL(process.env.E2E_AUTH);
const FUNCTIONS = {
  'upload-photo': 8601, 'format-recipe': 8602, 'lookup-nutrition': 8603, 'notify-message': 8604,
  'notify-activity': 8605, 'delete-account': 8606, 'sweep-storage': 8607,
};
const NO_VERIFY_JWT = new Set(['sweep-storage']);
const pool = new pg.Pool({ connectionString: process.env.E2E_DB_URL, max: 10 });

const files = new Map(); // 'bucket/name' -> Buffer
const stats = { anthropic: 0, usda: 0, pushes: [], stored: 0, refusedStorage: 0 };

// --- tokens ----------------------------------------------------------------------------
function verifyJwt(token) {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) return null;
  const want = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  try {
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

// --- helpers ---------------------------------------------------------------------------
const send = (res, status, body, headers = {}) => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', ...headers });
  res.end(buf);
};
const readBody = (req, cap = 30 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > cap) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

function proxy(req, res, target, path, body) {
  const up = http.request(
    { host: target.hostname, port: target.port, method: req.method, path,
      headers: { ...req.headers, host: `${target.hostname}:${target.port}` } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
  );
  // A server may answer before reading the whole body (a function refusing an
  // oversized upload from its declared size) and close the connection; the
  // answer it already gave is the one that counts.
  up.on('error', (e) =>
    setTimeout(() => { if (!res.headersSent) send(res, 502, { error: 'upstream', detail: String(e) }); }, 500));
  req.on('error', () => up.destroy());
  if (body) up.end(body); else req.pipe(up);
}

/** Run fn with a Postgres connection acting as the caller, as Storage does. */
async function asCaller(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const role = ['anon', 'authenticated', 'service_role'].includes(claims.role) ? claims.role : 'anon';
    await c.query(`set local role ${role}`);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// --- storage stand-in ------------------------------------------------------------------
function signToken(bucket, name, expiresIn) {
  const exp = Math.floor(Date.now() / 1000) + Number(expiresIn || 60);
  const payload = Buffer.from(JSON.stringify({ url: `${bucket}/${name}`, exp })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}
function checkSigned(token, bucket, name) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const want = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (want !== sig) return false;
  const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return p.url === `${bucket}/${name}` && p.exp * 1000 > Date.now();
}
const notFound = (res) => send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });

async function storage(req, res, url) {
  const parts = url.pathname.replace(/^\/storage\/v1\/object\/?/, '').split('/').map(decodeURIComponent);
  const token = bearer(req) || req.headers.apikey;
  const claims = verifyJwt(token);
  const isSignedGet = req.method === 'GET' && parts[0] === 'sign';
  if (!claims && !isSignedGet && parts[0] !== 'public') {
    return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'invalid signature' });
  }

  // Signed and public reads.
  if (req.method === 'GET' && (parts[0] === 'sign' || parts[0] === 'public' || parts[0] === 'authenticated')) {
    const [kind, bucket, ...rest] = parts;
    const name = rest.join('/');
    const bytes = files.get(`${bucket}/${name}`);
    if (kind === 'sign') return checkSigned(url.searchParams.get('token'), bucket, name) && bytes ? send(res, 200, bytes) : notFound(res);
    if (kind === 'public') {
      const { rows } = await pool.query('select public from storage.buckets where id = $1', [bucket]);
      return rows[0]?.public && bytes ? send(res, 200, bytes) : send(res, 400, { statusCode: '404', error: 'not_found', message: 'Bucket not found' });
    }
    const visible = await asCaller(claims, (c) =>
      c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name]));
    return visible.rowCount && bytes ? send(res, 200, bytes) : notFound(res);
  }

  // Signed links: one or many.
  if (req.method === 'POST' && parts[0] === 'sign') {
    const [, bucket, ...rest] = parts;
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const paths = rest.length ? [rest.join('/')] : body.paths || [];
    const out = [];
    for (const name of paths) {
      const visible = await asCaller(claims, (c) =>
        c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name]));
      out.push(visible.rowCount
        ? { path: name, signedURL: `/object/sign/${bucket}/${name}?token=${signToken(bucket, name, body.expiresIn)}`, error: null }
        : { path: name, signedURL: null, error: 'Either the object does not exist or you do not have permissions' });
    }
    if (rest.length) return out[0].error ? send(res, 400, { statusCode: '404', error: out[0].error }) : send(res, 200, { signedURL: out[0].signedURL });
    return send(res, 200, out);
  }

  // Listing a folder.
  if (req.method === 'POST' && parts[0] === 'list') {
    const bucket = parts[1];
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const prefix = String(body.prefix || '').replace(/\/$/, '');
    const r = await asCaller(claims, (c) =>
      c.query("select id, name from storage.objects where bucket_id = $1 and name like $2 || '/%' order by name limit $3",
        [bucket, prefix, Number(body.limit || 100)]));
    return send(res, 200, r.rows.map((o) => ({ id: o.id, name: o.name.slice(prefix.length + 1) })));
  }

  // Deleting.
  if (req.method === 'DELETE') {
    const bucket = parts[0];
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const r = await asCaller(claims, (c) =>
      c.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucket, body.prefixes || []]));
    for (const o of r.rows) files.delete(`${bucket}/${o.name}`);
    return send(res, 200, r.rows.map((o) => ({ name: o.name, bucket_id: bucket })));
  }

  // Uploading.
  if (req.method === 'POST' || req.method === 'PUT') {
    const [bucket, ...rest] = parts;
    const name = rest.join('/');
    let bytes;
    try { bytes = await readBody(req); } catch { return send(res, 413, { statusCode: '413', error: 'Payload too large' }); }
    const { rows } = await pool.query('select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket]);
    if (!rows[0]) return send(res, 400, { statusCode: '404', error: 'Bucket not found' });
    const type = String(req.headers['content-type'] || '').split(';')[0];
    if (rows[0].file_size_limit && bytes.length > Number(rows[0].file_size_limit)) {
      stats.refusedStorage++;
      return send(res, 413, { statusCode: '413', error: 'Payload too large' });
    }
    if (rows[0].allowed_mime_types && !rows[0].allowed_mime_types.includes(type)) {
      stats.refusedStorage++;
      return send(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
    }
    try {
      await asCaller(claims, async (c) => {
        const dup = await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name]);
        if (dup.rowCount) throw Object.assign(new Error('The resource already exists'), { status: 409 });
        await c.query('insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)',
          [bucket, name, claims.sub || null]);
      });
    } catch (e) {
      stats.refusedStorage++;
      return send(res, e.status || 403, { statusCode: String(e.status || 403), error: e.status ? 'Duplicate' : 'Unauthorized', message: e.message });
    }
    files.set(`${bucket}/${name}`, bytes);
    stats.stored++;
    return send(res, 200, { Key: `${bucket}/${name}` });
  }
  return send(res, 405, { error: 'not supported by the stand-in' });
}

// --- stand-ins for outside services ------------------------------------------------------
async function fakes(req, res, url) {
  const [, , host, ...rest] = url.pathname.split('/');
  const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString() || '{}') : {};
  if (host === 'api.anthropic.com') {
    stats.anthropic++;
    const user = String(body.messages?.[0]?.content ?? '');
    if (/<ingredients>/.test(user)) {
      const list = JSON.parse(user.split('<ingredients>')[1].split('</ingredients>')[0]);
      const text = JSON.stringify({ ingredients: list.map((i) => ({ grams: 100, search_term: String(i.item).toLowerCase() })) });
      return send(res, 200, { content: [{ type: 'text', text }] });
    }
    // A blurb that asks for the instructions gets a model that obeys it.
    const leaked = /instructions/i.test(user) ? String(body.system).split('. ')[0] + '.' : 'Garlic chicken';
    const text = JSON.stringify({
      is_recipe: true, title: leaked,
      ingredients: [{ item: 'chicken thighs', quantity: '2', unit: '' }, { item: 'garlic', quantity: '3', unit: 'cloves' }],
      steps: ['Rub the chicken with garlic.', 'Roast 25 minutes.'], cook_time_minutes: 25,
    });
    return send(res, 200, { content: [{ type: 'text', text }] });
  }
  if (host === 'api.nal.usda.gov') {
    stats.usda++;
    return send(res, 200, { foods: [{ fdcId: 1, description: 'stand-in food', foodNutrients: [
      { nutrientNumber: '208', value: 150 }, { nutrientNumber: '203', value: 20 }, { nutrientNumber: '204', value: 7 },
      { nutrientNumber: '205', value: 1 }, { nutrientNumber: '307', value: 80 }] }] });
  }
  if (host === 'exp.host') {
    stats.pushes.push(...(Array.isArray(body) ? body : [body]));
    return send(res, 200, { data: [{ status: 'ok' }] });
  }
  return send(res, 404, { error: 'unknown fake' });
}

// --- the server ------------------------------------------------------------------------
https.createServer(
  { key: fs.readFileSync(process.env.E2E_TLS_KEY), cert: fs.readFileSync(process.env.E2E_TLS_CERT) },
  async (req, res) => {
    const url = new URL(req.url, 'https://127.0.0.1');
    try {
      if (url.pathname.startsWith('/auth/v1/')) return proxy(req, res, AUTH, req.url.replace(/^\/auth\/v1/, ''));
      if (url.pathname.startsWith('/rest/v1/')) return proxy(req, res, REST, req.url.replace(/^\/rest\/v1/, ''));
      if (url.pathname.startsWith('/storage/v1/')) return await storage(req, res, url);
      if (url.pathname.startsWith('/__fakes/')) return await fakes(req, res, url);
      if (url.pathname === '/__stats') return send(res, 200, { ...stats, files: files.size });
      // Test-only window onto what analytics (0041) recorded for one person:
      // the app can't read this schema, so the checks look here instead.
      if (url.pathname === '/__analytics') {
        const who = url.searchParams.get('user');
        const q = (sql) => pool.query(sql, [who]).then((r) => r.rows);
        const [events, views, referral, dim] = await Promise.all([
          q('select name, count(*)::int as n from analytics.events where user_id = $1 group by name'),
          q('select count(*)::int as n from analytics.post_views where user_id = $1'),
          q('select referrer_user_id from analytics.referrals where new_user_id = $1'),
          q('select acquisition_source, referred_by, verified, post_count from analytics.dim_users where user_id = $1'),
        ]);
        return send(res, 200, {
          events: Object.fromEntries(events.map((e) => [e.name, e.n])),
          postViews: views[0]?.n ?? 0,
          referrer: referral[0]?.referrer_user_id ?? null,
          dim: dim[0] ?? null,
        });
      }
      const fn = url.pathname.match(/^\/functions\/v1\/([a-z-]+)/)?.[1];
      if (fn && FUNCTIONS[fn]) {
        // Supabase's gateway refuses a function call without a valid JWT
        // (the publishable key's JWT counts), unless deployed --no-verify-jwt.
        if (req.method !== 'OPTIONS' && !NO_VERIFY_JWT.has(fn) && !verifyJwt(bearer(req))) {
          return send(res, 401, { code: 401, message: 'Invalid JWT' });
        }
        return proxy(req, res, new URL(`http://127.0.0.1:${FUNCTIONS[fn]}`), url.search ? `/${url.search}` : '/');
      }
      return send(res, 404, { error: 'no route' });
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: 'gateway error' });
    }
  },
).listen(Number(process.env.E2E_PORT), '127.0.0.1', () => console.log('gateway up'));
