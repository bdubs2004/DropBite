// upload-photo's rules, with stand-ins for Supabase. Run: npm run test:upload
import { readFileSync } from 'fs';
import { join } from 'path';
import { handleUpload, UploadDeps } from '../handler.ts';

const FIX = join(process.cwd(), 'supabase', 'functions', '_shared', 'test-fixtures');
const jpeg = new Uint8Array(readFileSync(join(FIX, 'baseline.jpg')));
const png = new Uint8Array(readFileSync(join(FIX, 'red.png')));

const ALICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const CONV = '20000000-0000-4000-8000-000000000001';
const OTHER_CONV = '20000000-0000-4000-8000-000000000009';

function world(over: Partial<UploadDeps> = {}) {
  const stored: { bucket: string; path: string; bytes: Uint8Array }[] = [];
  let quota = 0;
  let origin: string | null = null;
  const deps: UploadDeps = {
    corsHeaders: {},
    storageOrigin: 'https://proj.supabase.co',
    userFromToken: async (jwt) => (jwt === 'alice-token' ? ALICE : null),
    canPostPhotoInConversation: async (_jwt, conv) => conv === CONV,
    consumeUploadQuota: async () => ++quota <= 3,
    store: async (bucket, path, bytes) => {
      if (stored.some((s) => s.bucket === bucket && s.path === path)) return { error: 'exists' };
      stored.push({ bucket, path, bytes });
      return {};
    },
    rememberStorageOrigin: async (o) => {
      origin = origin ?? o;
    },
    randomName: () => Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32),
    ...over,
  };
  return { deps, stored, origin: () => origin };
}

const req = (body: Uint8Array | string, headers: Record<string, string>, method = 'POST') =>
  new Request('https://fn/upload-photo', { method, body: method === 'POST' ? (body as any) : undefined, headers });

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  let w = world();
  let res = await handleUpload(req(jpeg, { 'x-photo-kind': 'post' }), w.deps);
  check('no token: refused', res.status === 401 && w.stored.length === 0, String(res.status));

  res = await handleUpload(req(jpeg, { Authorization: 'Bearer forged', 'x-photo-kind': 'post' }), w.deps);
  check('a forged token: refused', res.status === 401 && w.stored.length === 0, String(res.status));

  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token' }, 'GET'), w.deps);
  check('GET: refused', res.status === 405);

  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'script' }), w.deps);
  check('an unknown kind: refused', res.status === 400);

  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'post' }), w.deps);
  let body: any = await res.json();
  check('a post photo goes to the public bucket, in your own folder, with a random name',
    res.status === 200 && body.bucket === 'photos' && new RegExp(`^${ALICE}/[0-9a-f]{32}\\.jpg$`).test(body.path),
    `${res.status} ${body.path}`);
  check('...with its public link and size',
    body.url === `https://proj.supabase.co/storage/v1/object/public/photos/${body.path}` && body.width === 64 && body.height === 48);
  check('...and the project origin is on record for the database', w.origin() === 'https://proj.supabase.co');
  check('the stored file is the cleaned JPEG', w.stored[0]?.bytes[0] === 0xff && w.stored[0]?.bytes[1] === 0xd8);

  // The client can't choose where it goes.
  w = world();
  res = await handleUpload(req(jpeg, {
    Authorization: 'Bearer alice-token', 'x-photo-kind': 'avatar',
    'x-folder': 'bbbbbbbb-0000-4000-8000-000000000002', 'x-path': '../bob/avatar.jpg',
  }), w.deps);
  body = await res.json();
  check('a client can\'t pick the folder or file name', res.status === 200 && body.path.startsWith(`${ALICE}/`) && !body.path.includes('..'), body.path);

  w = world();
  res = await handleUpload(req(png, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'post', 'content-type': 'image/jpeg' }), w.deps);
  check('a PNG labelled image/jpeg: refused (the bytes decide, not the label)', res.status === 415 && w.stored.length === 0, String(res.status));

  res = await handleUpload(req('<html><script>alert(1)</script></html>', { Authorization: 'Bearer alice-token', 'x-photo-kind': 'comment', 'content-type': 'image/jpeg' }), w.deps);
  check('an HTML page labelled image/jpeg: refused', res.status === 415 && w.stored.length === 0);

  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'post', 'content-length': String(11 * 1024 * 1024) }), w.deps);
  check('a body declared over 10 MB: refused before reading it', res.status === 413);

  // DM photos.
  w = world();
  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'dm', 'x-conversation-id': CONV }), w.deps);
  body = await res.json();
  check('a DM photo goes to the private bucket, under the chat, with no public link',
    res.status === 200 && body.bucket === 'dm-photos' && body.path.startsWith(`${CONV}/`) && body.url === null, `${body.bucket} ${body.path}`);

  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'dm', 'x-conversation-id': OTHER_CONV }), w.deps);
  check('a DM photo for a chat you are not in: refused', res.status === 403);

  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'dm', 'x-conversation-id': '../photos' }), w.deps);
  check('a DM photo with a made-up chat id: refused', res.status === 400);

  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'dm' }), w.deps);
  check('a DM photo with no chat: refused', res.status === 400);

  // Rate limit (the stand-in allows 3).
  w = world();
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'post' }), w.deps)).status);
  }
  check('past the hourly cap: refused', statuses.join(',') === '200,200,200,429,429' && w.stored.length === 3, statuses.join(','));

  // Storage trouble surfaces as an error, never as a link to nothing.
  w = world({ store: async () => ({ error: 'boom' }) });
  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'post' }), w.deps);
  check('a storage failure returns an error, not a link', res.status === 500);

  w = world({ rememberStorageOrigin: async () => { throw new Error('db down'); } });
  res = await handleUpload(req(jpeg, { Authorization: 'Bearer alice-token', 'x-photo-kind': 'post' }), w.deps);
  check('if the origin can\'t be recorded, nothing is stored', res.status === 500 && w.stored.length === 0);

  if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nALL PASSED');
})();
