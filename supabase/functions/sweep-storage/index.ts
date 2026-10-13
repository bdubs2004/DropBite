// Supabase Edge Function: sweep-storage
//
// Deletes orphaned photos (see handler.ts). Run it daily with Supabase Cron
// (GO_LIVE.md has the steps); it can also be called by hand:
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/sweep-storage \
//     -H "x-sweep-secret: <SWEEP_SECRET>" -d '{"grace_hours": 24}'
//
// SWEEP_SECRET (supabase secrets set SWEEP_SECRET=$(openssl rand -hex 32)) can
// only start a sweep, so that's what the cron job keeps, not the service-role
// key. The service-role key as a bearer token still works.
//
// Once, after migration 0031, move DM photos sent before it into the private
// bucket (repeat until it reports moved: 0):
//
//   ... -d '{"migrate_legacy_dm_photos": true}'
//
// Each run also clears what closed moderation reports copied, once they're
// REPORT_RETENTION_DAYS old (default 730, never under 30; migration 0036).
//
// Deploy: supabase functions deploy sweep-storage --no-verify-jwt
// (needs migration 0031). --no-verify-jwt because the secret above is not a
// JWT; this function checks the caller itself.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleSweep } from './handler.ts';

const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Ignored unless it's long enough to be unguessable.
const SWEEP_SECRET = Deno.env.get('SWEEP_SECRET') ?? '';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE, {
  auth: { persistSession: false },
});

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve((req) =>
  handleSweep(req, {
    isServerSecret: (token) =>
      sameSecret(token, SERVICE) || (SWEEP_SECRET.length >= 32 && sameSecret(token, SWEEP_SECRET)),
    // Two years by default, as the privacy policy says.
    reportRetentionDays: Number(Deno.env.get('REPORT_RETENTION_DAYS') ?? '730'),
    async redactClosedReports(days) {
      const { data, error } = await admin.rpc('redact_closed_reports', { older_than: `${Math.round(days)} days` });
      if (error) {
        console.error('report retention failed (is migration 0036 in?)', error);
        throw error;
      }
      return typeof data === 'number' ? data : 0;
    },
    async findOrphans(graceHours, onlyBucket) {
      const { data, error } = await admin.rpc('storage_orphans', {
        grace: `${Math.round(graceHours * 60)} minutes`,
        only_bucket: onlyBucket,
      });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    async remove(bucket, paths) {
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) console.error('sweep remove failed', bucket, error);
      return { error: error?.message };
    },
    async legacyDmPhotos(limit) {
      const { data, error } = await admin
        .from('messages')
        .select('id, conversation_id, image_url')
        .not('image_url', 'is', null)
        .is('image_path', null)
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as { id: string; conversation_id: string; image_url: string }[];
    },
    async copyToDm(fromPath, toPath) {
      const { error } = await admin.storage
        .from('photos')
        .copy(fromPath, toPath, { destinationBucket: 'dm-photos' });
      if (error) console.error('legacy DM photo copy failed', fromPath, error);
      return { error: error?.message };
    },
    async setMessagePhoto(messageId, imagePath) {
      const { error } = await admin
        .from('messages')
        .update({ image_path: imagePath, image_url: null })
        .eq('id', messageId);
      return { error: error?.message };
    },
    randomName() {
      const b = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    },
  }),
);
