/**
 * What the app sends for analytics, and when (src/lib/analytics.ts).
 *
 * Run with: npm run test:analytics
 */
import { SESSION_GAP_MS, Tracker, VIEW_BATCH_MS } from '../analytics';

let failures = 0;
function check(label: string, pass: boolean, got?: unknown) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${got !== undefined ? `  — ${JSON.stringify(got)}` : ''}`);
}

// A clock and timers the test moves by hand.
let now = 1_000_000;
let pendingTimer: { fn: () => void; at: number } | null = null;
const timers = {
  now: () => now,
  setTimeout: (fn: () => void, ms: number) => (pendingTimer = { fn, at: now + ms }),
  clearTimeout: () => (pendingTimer = null),
};
function advance(ms: number) {
  now += ms;
  if (pendingTimer && pendingTimer.at <= now) {
    const t = pendingTimer;
    pendingTimer = null;
    t.fn();
  }
}

const sent: string[] = [];
let failSends = false;
const sender = {
  logEvent: async (name: string, postId?: string) => {
    if (failSends) throw new Error('offline');
    sent.push(postId ? `${name}:${postId}` : name);
  },
  logPostViews: async (ids: string[]) => {
    if (failSends) throw new Error('offline');
    sent.push(`views:${ids.join(',')}`);
  },
};
const t = new Tracker(() => sender as any, timers);
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  t.sessionStart();
  t.postsViewed(['p1']);
  t.inviteSent();
  check('signed out, nothing is sent', sent.length === 0 && pendingTimer === null, sent);

  t.setSignedIn(true);
  t.sessionStart();
  t.sessionStart();
  await flushPromises();
  check('signing in counts one visit, not two', sent.filter((x) => x === 'session_started').length === 1, sent);

  advance(SESSION_GAP_MS - 1000);
  t.sessionStart();
  await flushPromises();
  check('coming back within 30 minutes is the same visit', sent.filter((x) => x === 'session_started').length === 1);
  advance(2000);
  t.sessionStart();
  await flushPromises();
  check('coming back after 30 minutes is a new visit', sent.filter((x) => x === 'session_started').length === 2);

  sent.length = 0;
  t.postsViewed(['p1', 'p2']);
  t.postsViewed(['p2', 'p3']);
  await flushPromises();
  check('views wait to be sent together', sent.length === 0);
  advance(VIEW_BATCH_MS);
  await flushPromises();
  check('…then go in one batch, each post once', sent.join('|') === 'views:p1,p2,p3', sent);
  t.postsViewed(['p1', 'p3']);
  advance(VIEW_BATCH_MS);
  await flushPromises();
  check('a post seen again in the same session isn\'t sent again', sent.length === 1, sent);

  sent.length = 0;
  t.postsViewed(Array.from({ length: 120 }, (_, i) => `q${i}`));
  t.flush();
  await flushPromises();
  check('more than 50 views go in batches of 50', sent.length === 3 && sent[0].split(',').length === 50 && sent[2].split(',').length === 20,
    sent.map((s) => s.split(',').length));

  sent.length = 0;
  t.recipeViewed('p9');
  t.recipeViewed('p9');
  t.inviteSent();
  await flushPromises();
  check('a recipe opened twice counts once; an invite counts', sent.join('|') === 'recipe_viewed:p9|invite_sent', sent);

  failSends = true;
  let threw = false;
  try {
    advance(SESSION_GAP_MS + 1);
    t.sessionStart();
    t.postsViewed(['z1']);
    t.flush();
    t.inviteSent();
    await flushPromises();
  } catch {
    threw = true;
  }
  check('when sending fails (offline), the app never sees an error', !threw);
  failSends = false;

  const broken = new Tracker(() => {
    throw new Error('no service');
  }, timers);
  broken.setSignedIn(true);
  let threw2 = false;
  try {
    broken.sessionStart();
    broken.inviteSent();
  } catch {
    threw2 = true;
  }
  check('even with no service at all, nothing throws', !threw2);

  sent.length = 0;
  t.setSignedIn(false);
  t.setSignedIn(true);
  t.postsViewed(['p1']);
  t.sessionStart();
  advance(VIEW_BATCH_MS);
  await flushPromises();
  check('signing out and in again starts fresh (new visit, views count again)', sent.includes('session_started') && sent.includes('views:p1'), sent);

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll analytics checks passed');
})();
