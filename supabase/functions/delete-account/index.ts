// Supabase Edge Function: delete-account
// Deletes the calling user's auth record (requires service-role key, which
// only exists server-side). Row cascades wipe profile/posts/recipes/etc.
//
// Photos are NOT covered by those cascades and must be removed explicitly —
// see below. Missing that left every deleted user's images sitting in a
// public-read bucket, still reachable at their original URLs.
//
// Deploy: supabase functions deploy delete-account
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.length === 0) headers['Access-Control-Allow-Origin'] = '*';
  else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  // POST only, so this can't be triggered by a top-level navigation.
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json({ error: 'unauthorized' }, 401, cors);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401, cors);

    const userId = userData.user.id;

    // Photos first. Deleting the auth user cascades the database rows, but
    // storage objects are not part of that cascade: they would stay in the
    // bucket, and the bucket is public-read, so a deleted account's pictures
    // would remain fetchable by anyone holding the URL. Every upload path in
    // the app writes under `<user id>/`, which is what makes this sweep exact.
    let photosRemoved = 0;
    let photoError: string | null = null;
    try {
      // Always list from the start: each pass deletes what it lists, so the
      // next page is again at offset 0. The pass cap stops this spinning
      // forever if a remove ever reports success without deleting.
      for (let pass = 0; pass < 100; pass++) {
        const { data: files, error: listErr } = await admin.storage
          .from('photos')
          .list(userId, { limit: 100 });
        if (listErr) throw listErr;
        if (!files || files.length === 0) break;

        const { error: rmErr } = await admin.storage
          .from('photos')
          .remove(files.map((f) => `${userId}/${f.name}`));
        if (rmErr) throw rmErr;
        photosRemoved += files.length;

        if (pass === 99) throw new Error('photo cleanup did not converge');
      }
    } catch (e) {
      // Deliberately not fatal. Deleting the account is what the user asked
      // for and what the law requires; blocking it on a storage hiccup would
      // trap them in an account they have asked to leave. Log loudly instead
      // so the leftovers can be swept by hand — the prefix is in the message.
      photoError = String(e);
      console.error(`photo cleanup FAILED for ${userId}/ — sweep this prefix manually`, e);
    }

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('deleteUser failed', error);
      return json({ error: 'delete_failed' }, 500, cors);
    }

    console.log(`deleted account ${userId}, photos removed: ${photosRemoved}`);
    return json({ ok: true, photos_removed: photosRemoved, photo_error: photoError }, 200, cors);
  } catch (e) {
    console.error('delete-account failed', e);
    return json({ error: 'server_error' }, 500, cors);
  }
});

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
