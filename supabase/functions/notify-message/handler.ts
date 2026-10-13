// The notify-message request logic, kept free of Deno and Supabase imports so
// it can be tested with stand-ins (see __tests__/handler.test.ts). index.ts
// wires it to the real services.
//
// The app calls this right after sending a message: POST { conversationId,
// messageId }. A push goes to the thread's other members only when the server
// can claim that message for the caller (claim_message_push, migration 0032):
//   * the caller sent it, in the thread named, and is still in that thread;
//   * it was sent in the last few minutes;
//   * it hasn't been pushed already.
// So a caller can only ever push their own fresh messages, to the people who
// can already read them, once each. Calling again, or with another thread's id,
// sends nothing.
//
// Recipients are the other members who haven't muted the thread and aren't in
// a block with the sender. Errors never echo internals back to the caller.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MessageRow = {
  text?: string | null;
  shared_post_id?: string | null;
  shared_user_id?: string | null;
  image_url?: string | null;
  image_path?: string | null;
};

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: { conversationId: string; kind: 'dm'; title: string; isGroup: boolean };
};

export type NotifyDeps = {
  /** The signed-in user the token belongs to, or null. */
  userFromToken(jwt: string): Promise<string | null>;
  /** claim_message_push: true exactly once, for a fresh message the sender sent in that thread. */
  claimMessage(messageId: string, conversationId: string, senderId: string): Promise<boolean>;
  loadMessage(messageId: string): Promise<MessageRow | null>;
  senderName(senderId: string): Promise<string>;
  conversation(conversationId: string): Promise<{ title: string | null; isGroup: boolean | null }>;
  /** Members other than the sender, how many there are, and which of them to push. */
  recipients(conversationId: string, senderId: string): Promise<{ others: number; pushTo: string[] }>;
  tokensFor(userIds: string[]): Promise<string[]>;
  send(batch: PushMessage[]): Promise<void>;
  /**
   * Put the message's words in the notification (on by default, like
   * Instagram). Off, it says only "New message": the text then never passes
   * through Expo's and Apple's push services or shows on a lock screen.
   */
  showPreviews: boolean;
  corsHeaders: Record<string, string>;
};

/** What the lock screen shows. */
export function previewText(msg: MessageRow): string {
  const text = msg.text?.trim()
    ? msg.text.trim()
    : msg.shared_post_id
      ? 'Shared a post'
      : msg.shared_user_id
        ? 'Shared a profile'
        : msg.image_url || msg.image_path
          ? 'Sent a photo'
          : 'New message';
  return text.length > 160 ? text.slice(0, 157) + '…' : text;
}

export async function handleNotify(req: Request, deps: NotifyDeps): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...deps.corsHeaders, 'content-type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: deps.corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    const senderId = jwt ? await deps.userFromToken(jwt) : null;
    if (!senderId) return json({ error: 'unauthorized' }, 401);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad_request' }, 400);
    }
    const conversationId = String(body?.conversationId ?? '').toLowerCase();
    const messageId = String(body?.messageId ?? '').toLowerCase();
    if (!UUID.test(conversationId) || !UUID.test(messageId)) return json({ error: 'bad_request' }, 400);

    // The one gate. Anything that isn't the caller's own fresh, unpushed
    // message in that thread looks the same from outside: nothing sent.
    if (!(await deps.claimMessage(messageId, conversationId, senderId))) return json({ sent: 0 });

    const msg = await deps.loadMessage(messageId);
    if (!msg) return json({ sent: 0 });

    const { others, pushTo } = await deps.recipients(conversationId, senderId);
    if (!pushTo.length) return json({ sent: 0 });
    const tokens = [...new Set(await deps.tokensFor(pushTo))].filter(Boolean);
    if (!tokens.length) return json({ sent: 0 });

    const [name, conv] = await Promise.all([
      deps.senderName(senderId),
      deps.conversation(conversationId),
    ]);
    // Remembered on the thread (migration 0025): a group that's down to two
    // people after someone left still opens as a group.
    const isGroup = typeof conv.isGroup === 'boolean' ? conv.isGroup : others + 1 > 2;
    const title = conv.title ? `${name} · ${conv.title}` : name;
    // Header title if the recipient taps through: the group's name, else the
    // sender (who, in a 1:1, is exactly who they're talking to).
    const openTitle = conv.title || name;
    const body_ = deps.showPreviews ? previewText(msg) : 'New message';

    const pushes: PushMessage[] = tokens.map((to) => ({
      to,
      title,
      body: body_,
      sound: 'default',
      data: { conversationId, kind: 'dm', title: openTitle, isGroup },
    }));
    // Expo takes up to 100 per request.
    for (let i = 0; i < pushes.length; i += 100) await deps.send(pushes.slice(i, i + 100));

    return json({ sent: tokens.length });
  } catch (e) {
    console.error('notify-message failed', e);
    return json({ error: 'server_error' }, 500);
  }
}
