// notify-message's rules, with stand-ins for Supabase and Expo.
// Run: npm run test:notify
import { handleNotify, NotifyDeps, PushMessage, previewText } from '../handler.ts';

const ALICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const BOB = 'bbbbbbbb-0000-4000-8000-000000000002';
const CAROL = 'cccccccc-0000-4000-8000-000000000003';
const MALLORY = 'dddddddd-0000-4000-8000-000000000004';
const DM = '20000000-0000-4000-8000-000000000001'; // Alice + Bob
const GROUP = '20000000-0000-4000-8000-000000000002'; // Alice, Bob, Carol
const MSG = '30000000-0000-4000-8000-000000000001'; // Alice in DM
const GROUP_MSG = '30000000-0000-4000-8000-000000000002'; // Alice in GROUP

type Msg = { id: string; conv: string; sender: string; text: string; ageMin: number; pushed: boolean };

function world(over: Partial<NotifyDeps> = {}) {
  const messages: Msg[] = [
    { id: MSG, conv: DM, sender: ALICE, text: 'private to bob', ageMin: 0, pushed: false },
    { id: GROUP_MSG, conv: GROUP, sender: ALICE, text: 'dinner at 7?', ageMin: 0, pushed: false },
  ];
  const members: Record<string, { id: string; muted: boolean }[]> = {
    [DM]: [{ id: ALICE, muted: false }, { id: BOB, muted: false }],
    [GROUP]: [{ id: ALICE, muted: false }, { id: BOB, muted: false }, { id: CAROL, muted: true }],
  };
  const tokens: Record<string, string[]> = {
    [BOB]: ['ExponentPushToken[bob]'],
    [CAROL]: ['ExponentPushToken[carol]'],
    [MALLORY]: ['ExponentPushToken[mallory]'],
  };
  const sent: PushMessage[] = [];
  const deps: NotifyDeps = {
    corsHeaders: {},
    userFromToken: async (jwt) =>
      ({ 'alice-token': ALICE, 'bob-token': BOB, 'mallory-token': MALLORY } as Record<string, string>)[jwt] ?? null,
    // Mirrors claim_message_push in SQL (migration 0032).
    claimMessage: async (id, conv, sender) => {
      const m = messages.find((x) => x.id === id);
      const ok =
        !!m &&
        m.conv === conv &&
        m.sender === sender &&
        !m.pushed &&
        m.ageMin < 5 &&
        (members[conv] ?? []).some((x) => x.id === sender);
      if (ok) m!.pushed = true;
      return ok;
    },
    loadMessage: async (id) => messages.find((x) => x.id === id) ?? null,
    senderName: async (id) => (id === ALICE ? 'Alice' : 'Someone'),
    conversation: async (id) => ({ title: id === GROUP ? 'Supper club' : null, isGroup: id === GROUP }),
    recipients: async (conv, sender) => {
      const others = (members[conv] ?? []).filter((x) => x.id !== sender);
      return { others: others.length, pushTo: others.filter((x) => !x.muted).map((x) => x.id) };
    },
    tokensFor: async (ids) => ids.flatMap((id) => tokens[id] ?? []),
    send: async (batch) => {
      sent.push(...batch);
    },
    showPreviews: true,
    ...over,
  };
  return { deps, sent, messages, members };
}

const req = (body: unknown, token?: string, method = 'POST') =>
  new Request('https://fn/notify-message', {
    method,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

(async () => {
  let w = world();
  let res = await handleNotify(req({ conversationId: DM, messageId: MSG }), w.deps);
  check('no token: refused, nothing sent', res.status === 401 && w.sent.length === 0, String(res.status));

  res = await handleNotify(req({ conversationId: DM, messageId: MSG }, 'forged'), w.deps);
  check('a forged token: refused', res.status === 401 && w.sent.length === 0);

  res = await handleNotify(req({ conversationId: DM, messageId: MSG }, 'alice-token', 'GET'), w.deps);
  check('GET: refused', res.status === 405);

  res = await handleNotify(req('not json', 'alice-token'), w.deps);
  check('a body that isn\'t JSON: refused', res.status === 400 && w.sent.length === 0);

  res = await handleNotify(req({ conversationId: "x' or 1=1", messageId: MSG }, 'alice-token'), w.deps);
  check('ids that aren\'t ids: refused', res.status === 400 && w.sent.length === 0);

  // The real thing.
  res = await handleNotify(req({ conversationId: DM, messageId: MSG }, 'alice-token'), w.deps);
  let out = await res.json();
  check('the sender\'s own new message goes to the other person', res.status === 200 && out.sent === 1 && w.sent.length === 1 && w.sent[0].to === 'ExponentPushToken[bob]');
  check('…with their words and the sender\'s name', w.sent[0]?.body === 'private to bob' && w.sent[0]?.title === 'Alice');
  check('…and never to the sender', !w.sent.some((p) => p.to === 'ExponentPushToken[alice]'));

  res = await handleNotify(req({ conversationId: DM, messageId: MSG }, 'alice-token'), w.deps);
  out = await res.json();
  check('calling again sends nothing (no push spam)', out.sent === 0 && w.sent.length === 1);

  // Attacks with ids.
  w = world();
  res = await handleNotify(req({ conversationId: DM, messageId: MSG }, 'mallory-token'), w.deps);
  out = await res.json();
  check('an outsider can\'t push someone else\'s message', out.sent === 0 && w.sent.length === 0);

  res = await handleNotify(req({ conversationId: DM, messageId: MSG }, 'bob-token'), w.deps);
  out = await res.json();
  check('a member can\'t push the other person\'s message as theirs', out.sent === 0 && w.sent.length === 0);

  res = await handleNotify(req({ conversationId: GROUP, messageId: MSG }, 'alice-token'), w.deps);
  out = await res.json();
  check('a message can\'t be pushed into a different thread (its words would reach outsiders)', out.sent === 0 && w.sent.length === 0);

  w = world();
  w.messages[0].ageMin = 60;
  res = await handleNotify(req({ conversationId: DM, messageId: MSG }, 'alice-token'), w.deps);
  out = await res.json();
  check('an old message is never pushed late', out.sent === 0 && w.sent.length === 0);

  w = world();
  w.members[DM] = w.members[DM].filter((m) => m.id !== ALICE);
  res = await handleNotify(req({ conversationId: DM, messageId: MSG }, 'alice-token'), w.deps);
  out = await res.json();
  check('after leaving, you can\'t push into the thread', out.sent === 0 && w.sent.length === 0);

  // Groups.
  w = world();
  res = await handleNotify(req({ conversationId: GROUP, messageId: GROUP_MSG }, 'alice-token'), w.deps);
  out = await res.json();
  check('a group message skips whoever muted it', out.sent === 1 && w.sent.map((p) => p.to).join() === 'ExponentPushToken[bob]');
  check('…and is titled with the group', w.sent[0]?.title === 'Alice · Supper club' && w.sent[0]?.data.isGroup === true);

  // Failures don't leak internals.
  w = world({
    claimMessage: async () => {
      throw new Error('connection to db-internal-7.example:5432 refused');
    },
  });
  const logError = console.error;
  console.error = () => {}; // the handler logs it server-side; that's expected here
  res = await handleNotify(req({ conversationId: DM, messageId: MSG }, 'alice-token'), w.deps);
  console.error = logError;
  const text = await res.text();
  check('an internal error says only "server_error"', res.status === 500 && !text.includes('db-internal') && text.includes('server_error'));

  // Previews off: the words never leave the server.
  w = world({ showPreviews: false });
  await handleNotify(req({ conversationId: DM, messageId: MSG }, 'alice-token'), w.deps);
  check('with previews off, the push says only "New message"', w.sent.length === 1 && w.sent[0].body === 'New message' && !JSON.stringify(w.sent).includes('private to bob'));

  // Lock-screen text.
  check('photo preview', previewText({ text: '', image_path: 'x/y.jpg' }) === 'Sent a photo');
  check('long text is cut', previewText({ text: 'a'.repeat(400) }).length === 158);

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  if (failed) process.exit(1);
})();
