// Supabase Edge Function: notify-activity
//
// Push notifications for Activity: likes, comments, replies, comment likes,
// follows and follow-backs. Not shares, reposts, tags or saves; those stay in
// Activity only.
//
// The app calls this (no body needed) right after the caller likes,
// comments, replies, likes a comment or follows someone. The Activity rows
// themselves were already written by database triggers in the same request,
// so this just looks for rows the CALLER caused in the last few minutes that
// haven't been pushed yet, claims them (pushed_at) so each is pushed exactly
// once, and sends them to the recipients' phones. A caller can therefore only
// ever trigger pushes for things they really did, once each; calling it
// repeatedly sends nothing new.
//
// Deploy:  supabase functions deploy notify-activity
// Needs migration 0028 (notifications.pushed_at). Uses the SUPABASE_URL /
// SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY secrets Supabase injects.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

/** Which Activity kinds also go to your phone. */
const PUSHED = ['like', 'comment', 'reply', 'comment_like', 'follow', 'follow_back'];

/** Only rows this fresh: an old row is never pushed late. */
const WINDOW_MS = 5 * 60 * 1000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function clip(s: string, n = 120): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** "Dan liked your post", "Dan commented: looks so good", … */
export function activityText(type: string, name: string, commentText?: string | null): string {
  const said = commentText ? `: ${clip(commentText)}` : '';
  switch (type) {
    case 'like':
      return `${name} liked your post`;
    case 'comment':
      return `${name} commented${said || ' on your post'}`;
    case 'reply':
      return `${name} replied to your comment${said}`;
    case 'comment_like':
      return `${name} liked your comment${said}`;
    case 'follow':
      return `${name} started following you`;
    case 'follow_back':
      return `${name} followed you back`;
    default:
      return `${name} interacted with you`;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Who is calling.
    const asUser = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: me } = await asUser.auth.getUser();
    const actorId = me.user?.id;
    if (!actorId) return json({ error: 'not authenticated' }, 401);

    const admin = createClient(url, service);

    // Claim this caller's fresh, unpushed rows in one statement, so two calls
    // racing each other can't both send the same one.
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data: claimed, error } = await admin
      .from('notifications')
      .update({ pushed_at: new Date().toISOString() })
      .eq('actor_id', actorId)
      .is('pushed_at', null)
      .gte('created_at', since)
      .in('type', PUSHED)
      .select('id, user_id, type, post_id, comment_id');
    if (error) return json({ error: error.message }, 500);
    const rows = claimed ?? [];
    if (!rows.length) return json({ sent: 0 });

    const { data: actor } = await admin
      .from('users')
      .select('display_name, handle')
      .eq('id', actorId)
      .maybeSingle();
    const name = actor?.display_name || (actor?.handle ? '@' + actor.handle : 'Someone');

    // The words of the comment, for comment / reply / comment-like pushes.
    const commentIds = [...new Set(rows.map((r) => r.comment_id).filter(Boolean))];
    const texts = new Map<string, string>();
    if (commentIds.length) {
      const { data: cs } = await admin.from('comments').select('id, text').in('id', commentIds);
      for (const c of cs ?? []) texts.set(c.id, c.text ?? '');
    }

    const recipients = [...new Set(rows.map((r) => r.user_id))];
    const { data: tokenRows } = await admin
      .from('push_tokens')
      .select('user_id, token')
      .in('user_id', recipients);
    const tokensOf = new Map<string, string[]>();
    for (const t of tokenRows ?? []) {
      if (!t.token) continue;
      tokensOf.set(t.user_id, [...(tokensOf.get(t.user_id) ?? []), t.token]);
    }

    const messages = rows.flatMap((r) =>
      [...new Set(tokensOf.get(r.user_id) ?? [])].map((to) => ({
        to,
        body: activityText(r.type, name, r.comment_id ? texts.get(r.comment_id) : null),
        sound: 'default',
        data: {
          kind: 'activity',
          type: r.type,
          postId: r.post_id,
          commentId: r.comment_id,
          actorId,
        },
      })),
    );

    for (let i = 0; i < messages.length; i += 100) {
      await fetch(EXPO_PUSH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    }
    return json({ sent: messages.length });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
