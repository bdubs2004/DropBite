/**
 * What the app records for the owner's analytics (migration 0041,
 * docs/ANALYTICS.md): app opens, posts by other people seen, recipes opened
 * on someone else's post, and invites shared.
 *
 * Everything here is fire-and-forget: it never throws, never waits on the
 * network in front of the person, and does nothing while signed out. A post
 * seen twice in a session is sent once; views go in small batches.
 */

/** Long enough away that coming back counts as a new visit. */
export const SESSION_GAP_MS = 30 * 60 * 1000;
/** How long views wait to be sent together. */
export const VIEW_BATCH_MS = 3000;
/** Most post views the server takes in one call. */
export const VIEW_BATCH_MAX = 50;

export type AnalyticsSender = {
  logEvent(name: 'session_started' | 'recipe_viewed' | 'invite_sent', postId?: string): Promise<void>;
  logPostViews(postIds: string[]): Promise<void>;
};

type Timers = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class Tracker {
  private lastSession = -Infinity;
  private seenPosts = new Set<string>();
  private seenRecipes = new Set<string>();
  private pending: string[] = [];
  private timer: unknown = null;
  private signedIn = false;

  constructor(
    private readonly send: () => AnalyticsSender | null,
    private readonly timers: Timers = realTimers,
  ) {}

  /** Signed in or out. Signing out forgets this session's state. */
  setSignedIn(on: boolean) {
    if (on === this.signedIn) return;
    this.signedIn = on;
    if (!on) this.reset();
  }

  /** The app opened or came back to the front. At most once per SESSION_GAP_MS. */
  sessionStart() {
    if (!this.signedIn) return;
    const now = this.timers.now();
    if (now - this.lastSession < SESSION_GAP_MS) return;
    this.lastSession = now;
    this.fire((s) => s.logEvent('session_started'));
  }

  /** Posts by other people that came on screen. */
  postsViewed(postIds: string[]) {
    if (!this.signedIn) return;
    for (const id of postIds) {
      if (!id || this.seenPosts.has(id)) continue;
      this.seenPosts.add(id);
      this.pending.push(id);
    }
    if (this.pending.length && this.timer === null) {
      this.timer = this.timers.setTimeout(() => this.flush(), VIEW_BATCH_MS);
    }
  }

  /** A recipe opened on someone else's post, once per post per session. */
  recipeViewed(postId: string) {
    if (!this.signedIn || this.seenRecipes.has(postId)) return;
    this.seenRecipes.add(postId);
    this.fire((s) => s.logEvent('recipe_viewed', postId));
  }

  /** An invite went out through the share sheet. */
  inviteSent() {
    if (!this.signedIn) return;
    this.fire((s) => s.logEvent('invite_sent'));
  }

  /** Send the waiting views now (also runs on its own after VIEW_BATCH_MS). */
  flush() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    while (this.pending.length) {
      const batch = this.pending.splice(0, VIEW_BATCH_MAX);
      this.fire((s) => s.logPostViews(batch));
    }
  }

  private reset() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
    this.seenPosts.clear();
    this.seenRecipes.clear();
    this.lastSession = -Infinity;
  }

  private fire(call: (s: AnalyticsSender) => Promise<void>) {
    try {
      const s = this.send();
      if (s) call(s).catch(() => {});
    } catch {
      // Recording must never break the app.
    }
  }
}

let shared: Tracker | null = null;

/** The app's tracker, sending through the data service. */
export function analytics(): Tracker {
  if (!shared) {
    // Required lazily so this file stays free of the app's service graph (and
    // testable on its own).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    shared = new Tracker(() => require('../services').getDataService() as AnalyticsSender);
  }
  return shared;
}
