// The sweep-storage request logic, testable without Deno (see __tests__).
//
// Deletes orphaned photos: files in `photos` or `dm-photos` that no post,
// avatar, comment, message or open report points at any more, and that are
// older than a grace period (a photo uploaded a moment before its post is
// saved isn't an orphan yet). public.storage_orphans() decides what counts;
// this deletes through the Storage API, because deleting the rows in SQL would
// leave the actual files behind.
//
// Only the server may run it: the caller must present the service-role key
// (Supabase Cron does, see GO_LIVE.md). Anyone else gets 401.

export type SweepDeps = {
  /** True only for the service-role key (compared in constant time). */
  isServiceKey(token: string): boolean;
  /** 'bucket/path' for every orphan older than `graceHours`. */
  findOrphans(graceHours: number, onlyBucket: string | null): Promise<string[]>;
  remove(bucket: string, paths: string[]): Promise<{ error?: string }>;
  /** DM photos sent before they went private: still public links. */
  legacyDmPhotos(limit: number): Promise<{ id: string; conversation_id: string; image_url: string }[]>;
  copyToDm(fromPath: string, toPath: string): Promise<{ error?: string }>;
  /** Point the message at its private copy (and drop the public link). */
  setMessagePhoto(messageId: string, imagePath: string): Promise<{ error?: string }>;
  randomName(): string;
};

const PUBLIC_PHOTO = /\/storage\/v1\/object\/public\/photos\/([0-9a-f-]{36}\/[^/?#]+)$/i;

/** Never delete more than this in one run; the next run picks up the rest. */
export const MAX_PER_RUN = 2000;
const BATCH = 100;

export async function handleSweep(req: Request, deps: SweepDeps): Promise<Response> {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !deps.isServiceKey(token)) return json({ error: 'unauthorized' }, 401);

  let graceHours = 24;
  let onlyBucket: string | null = null;
  let migrate = false;
  try {
    const body = await req.json();
    migrate = body?.migrate_legacy_dm_photos === true;
    // Never less than 10 minutes, whatever is asked: an upload in flight
    // must not be swept from under its post.
    if (typeof body?.grace_hours === 'number') graceHours = Math.max(1 / 6, body.grace_hours);
    if (body?.bucket === 'photos' || body?.bucket === 'dm-photos') onlyBucket = body.bucket;
  } catch {
    // No body: the defaults.
  }

  // One-off: move DM photos sent before 0031 into the private bucket. The
  // public originals become orphans and go in a later sweep, once nothing
  // (a report, say) still points at them.
  if (migrate) {
    const moved: string[] = [];
    const failed: string[] = [];
    for (const m of await deps.legacyDmPhotos(MAX_PER_RUN)) {
      const from = PUBLIC_PHOTO.exec(m.image_url)?.[1];
      if (!from || from.includes('..')) {
        failed.push(m.id);
        continue;
      }
      const to = `${m.conversation_id}/${deps.randomName()}.jpg`;
      const copied = await deps.copyToDm(from, to);
      const saved = copied.error ? copied : await deps.setMessagePhoto(m.id, to);
      if (saved.error) failed.push(m.id);
      else moved.push(m.id);
    }
    return json({ moved: moved.length, failed }, failed.length ? 500 : 200);
  }

  const orphans = (await deps.findOrphans(graceHours, onlyBucket)).slice(0, MAX_PER_RUN);
  const byBucket = new Map<string, string[]>();
  for (const full of orphans) {
    const slash = full.indexOf('/');
    const bucket = full.slice(0, slash);
    const path = full.slice(slash + 1);
    if (bucket !== 'photos' && bucket !== 'dm-photos') continue;
    if (!path || path.includes('..')) continue;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path]);
  }

  let removed = 0;
  const errors: string[] = [];
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += BATCH) {
      const batch = paths.slice(i, i + BATCH);
      const res = await deps.remove(bucket, batch);
      if (res.error) errors.push(`${bucket}: ${res.error}`);
      else removed += batch.length;
    }
  }
  return json({ found: orphans.length, removed, errors }, errors.length ? 500 : 200);
}
