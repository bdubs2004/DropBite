// sweep-storage's rules, with stand-ins. Run: npm run test:sweep
import { handleSweep, MAX_PER_RUN, SweepDeps } from '../handler.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

function world(orphans: string[], over: Partial<SweepDeps> = {}) {
  const removed: { bucket: string; paths: string[] }[] = [];
  const asked: { grace: number; bucket: string | null }[] = [];
  const redacted: number[] = [];
  const deps: SweepDeps = {
    isServerSecret: (t) => t === 'service-key' || t === 'sweep-secret',
    reportRetentionDays: 730,
    redactClosedReports: async (days) => {
      redacted.push(days);
      return 2;
    },
    findOrphans: async (grace, bucket) => {
      asked.push({ grace, bucket });
      return orphans;
    },
    remove: async (bucket, paths) => {
      removed.push({ bucket, paths });
      return {};
    },
    legacyDmPhotos: async () => [],
    copyToDm: async () => ({}),
    setMessagePhoto: async () => ({}),
    randomName: () => 'f'.repeat(32),
    ...over,
  };
  return { deps, removed, asked, redacted };
}
const req = (auth: string | null, body?: unknown, method = 'POST', headers: Record<string, string> = {}) =>
  new Request('https://fn/sweep-storage', {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers },
    body: body === undefined || method !== 'POST' ? undefined : JSON.stringify(body),
  });

(async () => {
  let w = world(['photos/u/a.jpg']);
  let res = await handleSweep(req(null), w.deps);
  check('no key: refused, nothing deleted', res.status === 401 && w.removed.length === 0);
  res = await handleSweep(req('a-user-token'), w.deps);
  check('a user token: refused, nothing deleted', res.status === 401 && w.removed.length === 0);
  res = await handleSweep(req('service-key', undefined, 'GET'), w.deps);
  check('GET: refused', res.status === 405);
  res = await handleSweep(req(null, {}, 'POST', { 'x-sweep-secret': 'a-guess' }), w.deps);
  check('a wrong sweep secret: refused, nothing deleted', res.status === 401 && w.removed.length === 0);
  res = await handleSweep(req(null, {}, 'POST', { 'x-sweep-secret': 'sweep-secret' }), w.deps);
  check('the sweep secret (what the cron job keeps) runs it', res.status === 200 && w.removed.length === 1);

  w = world(['photos/u1/a.jpg', 'dm-photos/c1/b.jpg', 'photos/u2/c.jpg']);
  res = await handleSweep(req('service-key'), w.deps);
  const body: any = await res.json();
  check('removes each orphan from its own bucket', res.status === 200 && body.removed === 3 &&
    JSON.stringify(w.removed) === JSON.stringify([
      { bucket: 'photos', paths: ['u1/a.jpg', 'u2/c.jpg'] },
      { bucket: 'dm-photos', paths: ['c1/b.jpg'] },
    ]), JSON.stringify(w.removed));
  check('defaults to a day of grace', w.asked[0].grace === 24 && w.asked[0].bucket === null);
  check('each run also clears old closed reports (two years by default)', w.redacted.join() === '730' && body.reports_redacted === 2);
  w = world([], { reportRetentionDays: 1 });
  await handleSweep(req('service-key'), w.deps);
  check('report copies are never cleared sooner than 30 days', w.redacted.join() === '30');
  w = world(['photos/u1/a.jpg'], { redactClosedReports: async () => { throw new Error('no 0036'); } });
  res = await handleSweep(req('service-key'), w.deps);
  check('a retention failure doesn\'t stop the photo sweep', res.status === 200 && w.removed.length === 1);

  w = world([]);
  await handleSweep(req('service-key', { grace_hours: 0, bucket: 'dm-photos' }), w.deps);
  check('never less than 10 minutes of grace, even if asked', Math.abs(w.asked[0].grace - 1 / 6) < 1e-9 && w.asked[0].bucket === 'dm-photos');

  w = world(['secrets/x', 'photos/../other/x.jpg', 'photos/', 'photos/ok.jpg']);
  res = await handleSweep(req('service-key'), w.deps);
  check('ignores anything outside the two buckets or with odd paths',
    JSON.stringify(w.removed) === JSON.stringify([{ bucket: 'photos', paths: ['ok.jpg'] }]), JSON.stringify(w.removed));

  w = world(Array.from({ length: MAX_PER_RUN + 500 }, (_, i) => `photos/u/${i}.jpg`));
  res = await handleSweep(req('service-key'), w.deps);
  const total = w.removed.reduce((n, r) => n + r.paths.length, 0);
  check('caps one run, in batches of 100', total === MAX_PER_RUN && w.removed.every((r) => r.paths.length <= 100), `${total} in ${w.removed.length} batches`);

  w = world(['photos/u/a.jpg'], { remove: async () => ({ error: 'boom' }) });
  res = await handleSweep(req('service-key'), w.deps);
  check('a storage failure is reported, not hidden', res.status === 500);

  // Moving DM photos sent before they went private.
  const copies: string[] = [];
  const saved: string[] = [];
  w = world([], {
    legacyDmPhotos: async () => [
      { id: 'm1', conversation_id: 'c0000000-0000-4000-8000-000000000001', image_url: 'https://p.supabase.co/storage/v1/object/public/photos/aaaaaaaa-0000-4000-8000-000000000001/1700000000000.jpg' },
      { id: 'm2', conversation_id: 'c0000000-0000-4000-8000-000000000001', image_url: 'https://evil.example/x.jpg' },
    ],
    copyToDm: async (from, to) => { copies.push(`${from} -> ${to}`); return {}; },
    setMessagePhoto: async (id, path) => { saved.push(`${id}=${path}`); return {}; },
  });
  res = await handleSweep(req('service-key', { migrate_legacy_dm_photos: true }), w.deps);
  const moved: any = await res.json();
  check('moves an old public DM photo into the private bucket under its chat',
    copies[0] === `aaaaaaaa-0000-4000-8000-000000000001/1700000000000.jpg -> c0000000-0000-4000-8000-000000000001/${'f'.repeat(32)}.jpg`
      && saved[0] === `m1=c0000000-0000-4000-8000-000000000001/${'f'.repeat(32)}.jpg`, copies[0]);
  check('skips (and reports) a link that isn\'t one of our photos', moved.moved === 1 && moved.failed.join() === 'm2' && copies.length === 1);
  check('...and deletes nothing itself (the sweep does, once unused)', w.removed.length === 0);
  w = world([], { legacyDmPhotos: async () => [{ id: 'm1', conversation_id: 'c1', image_url: 'https://p/storage/v1/object/public/photos/aaaaaaaa-0000-4000-8000-000000000001/a.jpg' }] });
  res = await handleSweep(req('user-token', { migrate_legacy_dm_photos: true }), w.deps);
  check('only the server can run the move', res.status === 401);

  if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nALL PASSED');
})();
