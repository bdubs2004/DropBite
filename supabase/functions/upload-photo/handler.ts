// The upload-photo request logic, kept free of Deno and Supabase imports so it
// can be tested with stand-ins (see __tests__/handler.test.ts). index.ts wires
// it to the real services.
//
// The app sends the photo's bytes; this function decides everything else:
//   * that it is really a JPEG (the bytes, not the Content-Type), cleaned of
//     metadata, at most 10 MB, a sane size in pixels;
//   * where it goes: post, avatar and comment photos to the public `photos`
//     bucket under the caller's own folder; DM photos to the private
//     `dm-photos` bucket under the conversation, and only if the caller is in
//     that conversation and not blocked by anyone in it;
//   * its name: 128 random bits, so no path can be guessed or overwritten;
//   * how often: a per-user hourly cap, so nobody can fill the bucket.
// Clients can't upload to storage directly at all (migration 0031).
import { cleanJpeg, MAX_PHOTO_BYTES } from '../_shared/jpeg.ts';

export type PhotoKind = 'post' | 'avatar' | 'comment' | 'dm';
const KINDS: PhotoKind[] = ['post', 'avatar', 'comment', 'dm'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UploadDeps = {
  /** The signed-in user the token belongs to, or null. */
  userFromToken(jwt: string): Promise<string | null>;
  /** Is the caller in the conversation, with nobody in it blocking them? */
  canPostPhotoInConversation(jwt: string, conversationId: string): Promise<boolean>;
  /** Counts one upload; false once the user is over the hourly cap. */
  consumeUploadQuota(userId: string): Promise<boolean>;
  /** Store the bytes. Never overwrites. */
  store(bucket: string, path: string, bytes: Uint8Array): Promise<{ error?: string }>;
  /** Records the project's storage origin, so the database can check photo links. */
  rememberStorageOrigin(origin: string): Promise<void>;
  /** 32 hex characters from a CSPRNG. */
  randomName(): string;
  /** e.g. https://abcd.supabase.co */
  storageOrigin: string;
  corsHeaders: Record<string, string>;
};

export async function handleUpload(req: Request, deps: UploadDeps): Promise<Response> {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...deps.corsHeaders, 'content-type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: deps.corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const userId = jwt ? await deps.userFromToken(jwt) : null;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const kind = (req.headers.get('x-photo-kind') ?? '') as PhotoKind;
  if (!KINDS.includes(kind)) return json({ error: 'bad_kind' }, 400);
  const conversationId = (req.headers.get('x-conversation-id') ?? '').toLowerCase();
  if (kind === 'dm' && !UUID.test(conversationId)) return json({ error: 'bad_conversation' }, 400);

  // Refuse an oversized body before reading it, when the client says its size.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_PHOTO_BYTES) return json({ error: 'too_large' }, 413);

  if (kind === 'dm' && !(await deps.canPostPhotoInConversation(jwt, conversationId))) {
    return json({ error: 'not_allowed' }, 403);
  }
  if (!(await deps.consumeUploadQuota(userId))) return json({ error: 'rate_limited' }, 429);

  const raw = new Uint8Array(await req.arrayBuffer());
  const photo = cleanJpeg(raw);
  if (!photo.ok) {
    return json({ error: photo.reason }, photo.reason === 'too_large' ? 413 : 415);
  }

  // Before storing: the database checks photo links against this origin, so
  // it must be on record by the time the app saves the link.
  try {
    await deps.rememberStorageOrigin(deps.storageOrigin);
  } catch {
    return json({ error: 'storage_failed' }, 500);
  }

  const bucket = kind === 'dm' ? 'dm-photos' : 'photos';
  const path = `${kind === 'dm' ? conversationId : userId}/${deps.randomName()}.jpg`;
  const stored = await deps.store(bucket, path, photo.bytes);
  if (stored.error) return json({ error: 'storage_failed' }, 500);

  return json(
    {
      bucket,
      path,
      // DM photos have no public link: the app asks for a short-lived signed one.
      url: bucket === 'photos' ? `${deps.storageOrigin}/storage/v1/object/public/photos/${path}` : null,
      width: photo.width,
      height: photo.height,
    },
    200,
  );
}
