// Supabase Edge Function: notify-message
//
// Sends an Expo push notification to the other members of a DM thread when a
// new message is sent. Called by the app right after it sends a message:
//   POST { conversationId, messageId }
//
// Why client-triggered rather than a DB trigger: it needs no pg_net, no webhook
// wiring and no stored service URL — just deploy the function. The caller's JWT
// proves who they are; we verify they're actually a member before sending, and
// we use the service role only to read the OTHER members' tokens (which RLS
// would otherwise hide).
//
// Deploy:  supabase functions deploy notify-message
// (Uses the SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY secrets
//  that Supabase injects into every function automatically.)

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';

    const { conversationId, messageId } = await req.json();
    if (!conversationId || !messageId) {
      return json({ error: 'conversationId and messageId required' }, 400);
    }

    // Who is calling (their RLS context) — must be a member of this thread.
    const asUser = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: me } = await asUser.auth.getUser();
    const senderId = me.user?.id;
    if (!senderId) return json({ error: 'not authenticated' }, 401);

    const admin = createClient(url, service);

    // Confirm the sender really is in this conversation.
    const { data: membership } = await admin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', senderId)
      .maybeSingle();
    if (!membership) return json({ error: 'not a member' }, 403);

    // The message, for the preview text.
    const { data: msg } = await admin
      .from('messages')
      .select('text, shared_post_id, image_url, sender_id')
      .eq('id', messageId)
      .maybeSingle();
    if (!msg || msg.sender_id !== senderId) return json({ error: 'no such message' }, 404);

    // Sender's display name for the title.
    const { data: sender } = await admin
      .from('users')
      .select('display_name, handle')
      .eq('id', senderId)
      .maybeSingle();
    const senderName = sender?.display_name || (sender?.handle ? '@' + sender.handle : 'Someone');

    // Group name, if any, so the title reads "Name (Group)".
    const { data: conv } = await admin
      .from('conversations')
      .select('title')
      .eq('id', conversationId)
      .maybeSingle();

    // Recipients: every other member who has NOT muted this thread.
    const { data: recipients } = await admin
      .from('conversation_members')
      .select('user_id, muted')
      .eq('conversation_id', conversationId)
      .neq('user_id', senderId);
    const targetIds = (recipients ?? []).filter((r) => !r.muted).map((r) => r.user_id);
    if (!targetIds.length) return json({ sent: 0 });

    const { data: tokenRows } = await admin
      .from('push_tokens')
      .select('token')
      .in('user_id', targetIds);
    const tokens = [...new Set((tokenRows ?? []).map((t) => t.token))].filter(Boolean);
    if (!tokens.length) return json({ sent: 0 });

    const preview = msg.text?.trim()
      ? msg.text.trim()
      : msg.shared_post_id
        ? 'Shared a post'
        : msg.image_url
          ? 'Sent a photo'
          : 'New message';
    const isGroup = (recipients ?? []).length + 1 > 2;
    const title = conv?.title ? `${senderName} · ${conv.title}` : senderName;
    // Header title to show if the recipient taps through: the group's name, else
    // the sender (who, in a 1:1, is exactly who they're talking to).
    const openTitle = conv?.title || senderName;

    const messages = tokens.map((to) => ({
      to,
      title,
      body: preview.length > 160 ? preview.slice(0, 157) + '…' : preview,
      sound: 'default',
      data: { conversationId, kind: 'dm', title: openTitle, isGroup },
    }));

    // Expo accepts up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      await fetch(EXPO_PUSH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    }

    return json({ sent: tokens.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
