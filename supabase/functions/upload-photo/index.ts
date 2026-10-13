// Supabase Edge Function: upload-photo
//
// The only way photos get into storage. The app sends the bytes; this checks
// they're a real JPEG, strips metadata (EXIF GPS and the like), picks the
// bucket, folder and a random name, and stores it. See handler.ts for the
// rules; this file only connects them to Supabase.
//
// Request:  POST, Authorization: Bearer <user token>, body = the JPEG bytes
//           x-photo-kind: post | avatar | comment | dm
//           x-conversation-id: <uuid>   (dm only)
// Response: { bucket, path, url, width, height }   (url is null for DM photos)
//
// Deploy: supabase functions deploy upload-photo
// Needs migration 0031. UPLOAD_HOURLY_LIMIT (default 60) caps uploads per user.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleUpload } from './handler.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HOURLY = Number(Deno.env.get('UPLOAD_HOURLY_LIMIT') ?? '60');

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-photo-kind, x-conversation-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.length === 0) headers['Access-Control-Allow-Origin'] = '*';
  else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
let originRemembered = false;

Deno.serve((req) =>
  handleUpload(req, {
    corsHeaders: corsHeaders(req.headers.get('Origin')),
    storageOrigin: new URL(URL_).origin,

    async userFromToken(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      return error || !data.user ? null : data.user.id;
    },

    async canPostPhotoInConversation(jwt, conversationId) {
      // Asked as the user, so the answer is about them (these helpers only
      // answer about the caller).
      const asUser = createClient(URL_, ANON, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data: me } = await asUser.auth.getUser(jwt);
      const who = me.user?.id;
      if (!who) return false;
      const [member, blocked] = await Promise.all([
        asUser.rpc('is_conversation_member', { conv: conversationId, who }),
        asUser.rpc('conversation_has_block', { conv: conversationId, who }),
      ]);
      return member.data === true && blocked.data === false;
    },

    async consumeUploadQuota(userId) {
      const { data, error } = await admin.rpc('consume_upload_quota', {
        target: userId,
        hourly_limit: HOURLY,
      });
      if (error) {
        console.error('upload quota check failed', error);
        return false; // fail closed: an unmetered upload is the thing to avoid
      }
      return data === true;
    },

    async store(bucket, path, bytes) {
      const { error } = await admin.storage.from(bucket).upload(path, bytes, {
        contentType: 'image/jpeg',
        upsert: false,
        cacheControl: '31536000',
      });
      if (error) console.error('upload failed', bucket, error);
      return { error: error?.message };
    },

    async rememberStorageOrigin(origin) {
      if (originRemembered) return;
      // Insert-once: the first upload records where this project's photos
      // live, which is what the database checks photo links against.
      const { error } = await admin
        .from('app_config')
        .upsert({ key: 'storage_origin', value: origin }, { onConflict: 'key', ignoreDuplicates: true });
      if (error) throw error;
      originRemembered = true;
    },

    randomName() {
      const b = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    },
  }),
);
