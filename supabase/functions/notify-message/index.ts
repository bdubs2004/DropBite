// Supabase Edge Function: notify-message
//
// Sends an Expo push notification to the other members of a DM thread when a
// new message is sent. Called by the app right after it sends a message:
//   POST { conversationId, messageId }
//
// Why client-triggered rather than a DB trigger: it needs no pg_net, no webhook
// wiring and no stored service URL, just deploy the function. The rules (only
// your own fresh message, once, to the people in that thread) are in
// handler.ts; this file only connects them to Supabase and Expo.
//
// Deploy:  supabase functions deploy notify-message
// Needs migration 0032 (claim_message_push); without it nothing is pushed.
// Uses the SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets Supabase injects.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleNotify } from './handler.ts';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

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

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve((req) =>
  handleNotify(req, {
    corsHeaders: corsHeaders(req.headers.get('Origin')),

    async userFromToken(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      return error || !data.user ? null : data.user.id;
    },

    async claimMessage(messageId, conversationId, senderId) {
      const { data, error } = await admin.rpc('claim_message_push', {
        msg: messageId,
        conv: conversationId,
        sender: senderId,
      });
      if (error) {
        console.error('claim_message_push failed (is migration 0032 in?)', error);
        return false; // fail closed: never push what can't be claimed
      }
      return data === true;
    },

    async loadMessage(messageId) {
      const { data } = await admin
        .from('messages')
        .select('text, shared_post_id, shared_user_id, image_url, image_path')
        .eq('id', messageId)
        .maybeSingle();
      return data;
    },

    async senderName(senderId) {
      const { data } = await admin
        .from('users')
        .select('display_name, handle')
        .eq('id', senderId)
        .maybeSingle();
      return data?.display_name || (data?.handle ? '@' + data.handle : 'Someone');
    },

    async conversation(conversationId) {
      const { data } = await admin
        .from('conversations')
        .select('title, is_group')
        .eq('id', conversationId)
        .maybeSingle();
      return { title: data?.title ?? null, isGroup: data?.is_group ?? null };
    },

    async recipients(conversationId, senderId) {
      const { data: members } = await admin
        .from('conversation_members')
        .select('user_id, muted')
        .eq('conversation_id', conversationId)
        .neq('user_id', senderId);
      const others = members ?? [];
      const unmuted = others.filter((m) => !m.muted).map((m) => m.user_id as string);
      if (!unmuted.length) return { others: others.length, pushTo: [] };
      // Nobody gets a push from someone they've blocked or who blocked them,
      // even if the block came after the message.
      const { data: blocks } = await admin
        .from('blocks')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${senderId},blocked_id.eq.${senderId}`);
      const blocked = new Set(
        (blocks ?? []).map((b) => (b.blocker_id === senderId ? b.blocked_id : b.blocker_id)),
      );
      return { others: others.length, pushTo: unmuted.filter((id) => !blocked.has(id)) };
    },

    async tokensFor(userIds) {
      const { data } = await admin.from('push_tokens').select('token').in('user_id', userIds);
      return (data ?? []).map((t) => t.token as string);
    },

    async send(batch) {
      await fetch(EXPO_PUSH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(batch),
      });
    },
  }),
);
