// Supabase Edge Function: sweep-storage
//
// Deletes orphaned photos (see handler.ts). Run it daily with Supabase Cron
// (GO_LIVE.md has the steps); it can also be called by hand:
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/sweep-storage \
//     -H "Authorization: Bearer <service role key>" -d '{"grace_hours": 24}'
//
// Once, after migration 0031, move DM photos sent before it into the private
// bucket (repeat until it reports moved: 0):
//
//   ... -d '{"migrate_legacy_dm_photos": true}'
//
// Deploy: supabase functions deploy sweep-storage   (needs migration 0031)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleSweep } from './handler.ts';

const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
    isServiceKey: (token) => sameSecret(token, SERVICE),
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
