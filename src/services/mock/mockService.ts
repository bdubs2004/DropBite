import AsyncStorage from '@react-native-async-storage/async-storage';
import { hashPassword, verifyPassword } from '../../lib/demoPassword';
import { uid } from '../../lib/id';
import { appVersion, platformName } from '../../lib/appInfo';
import { clamp, clampOrNull, LIMITS } from '../../lib/limits';
import { collectionNameProblem, tidyCollectionName } from '../../lib/collectionName';
import { daysBetween, localDateString } from '../../lib/time';
import {
  AppNotification,
  Collection,
  Comment,
  SignUpResult,
  Feedback,
  FeedbackKind,
  Conversation,
  Message,
  NewPostInput,
  NotificationPrefs,
  DiscoverPerson,
  LeaderboardEntry,
  LeaderboardScope,
  Post,
  Recipe,
  Report,
  ReportReason,
  Streak,
  User,
} from '../../types';
import { DataService } from '../types';
import {
  SEED_COLLECTION_POSTS,
  SEED_COLLECTIONS,
  SEED_COMMENTS,
  SEED_FOLLOWING,
  SEED_FOLLOWS,
  SEED_POSTS,
  SEED_REACTIONS,
  SEED_REPOSTS,
  SEED_SHARES,
  SEED_USERS,
} from './seed';

// Kept as 'nibl.*' through the NiblGo rename on purpose: changing the key
// would orphan every existing demo account and preference on device.
const KEY = 'nibl.demo.v1';

/**
 * Sort by current streak (longest streak breaks ties) and assign 1-based
 * ranks, with equal streaks sharing a rank.
 */
function rankEntries(
  rows: { user: User; current_streak: number; longest_streak: number; is_me: boolean }[],
): LeaderboardEntry[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.current_streak - a.current_streak ||
      b.longest_streak - a.longest_streak ||
      a.user.display_name.localeCompare(b.user.display_name),
  );
  let lastStreak: number | null = null;
  let lastRank = 0;
  return sorted.map((row, i) => {
    const rank = row.current_streak === lastStreak ? lastRank : i + 1;
    lastStreak = row.current_streak;
    lastRank = rank;
    return { ...row, rank };
  });
}


interface Db {
  users: User[];
  posts: Post[];
  recipes: Recipe[];
  follows: { follower_id: string; followee_id: string }[];
  reactions: { post_id: string; user_id: string }[];
  comments: Comment[];
  reposts: { post_id: string; user_id: string }[];
  shares: { post_id: string; user_id: string }[];
  saves: { post_id: string; user_id: string }[];
  /** Optional: demo databases saved before collections existed lack these. */
  collections?: { id: string; user_id: string; name: string; created_at: string }[];
  collectionPosts?: { collection_id: string; post_id: string; added_at: string }[];
  commentReactions: { comment_id: string; user_id: string }[];
  conversations: { id: string; created_at: string; updated_at: string }[];
  conversationMembers: {
    conversation_id: string;
    user_id: string;
    last_read_at: string;
    muted?: boolean;
  }[];
  messages: Message[];
  /** Optional: demo databases saved before reactions existed lack it. */
  messageReactions?: { message_id: string; user_id: string; emoji: string }[];
  /** Optional: demo databases saved before tagging existed lack it. */
  postTags?: { post_id: string; user_id: string }[];
  blocks: { blocker_id: string; blocked_id: string }[];
  reports: Report[];
  feedback: Feedback[];
  notifications: AppNotification[];
  streaks: Streak[];
  sessionUserId: string | null;
  /** password_hash is a salted digest. `password` is the legacy plaintext
   *  field, upgraded and erased on the owner's next sign-in. */
  credentials: { email: string; password_hash?: string; password?: string; userId: string }[];
  notificationPrefs: NotificationPrefs;
}

function freshDb(): Db {
  return {
    users: [...SEED_USERS],
    posts: SEED_POSTS.map(({ recipe, ...p }) => ({ ...p })),
    recipes: SEED_POSTS.flatMap((p) => (p.recipe ? [p.recipe] : [])),
    follows: [...SEED_FOLLOWS],
    reactions: [...SEED_REACTIONS],
    comments: [...SEED_COMMENTS],
    reposts: [...SEED_REPOSTS],
    shares: [...SEED_SHARES],
    saves: [],
    collections: [...SEED_COLLECTIONS],
    collectionPosts: [...SEED_COLLECTION_POSTS],
    commentReactions: [],
    conversations: [],
    conversationMembers: [],
    messages: [],
    blocks: [],
    reports: [],
    feedback: [],
    notifications: [],
    streaks: [
      { user_id: 'u-marge', current_streak: 12, longest_streak: 34, last_post_date: localDateString() },
      { user_id: 'u-dan', current_streak: 5, longest_streak: 21, last_post_date: localDateString() },
      { user_id: 'u-lily', current_streak: 8, longest_streak: 15, last_post_date: localDateString(new Date(Date.now() - 86400000)) },
      { user_id: 'u-carol', current_streak: 19, longest_streak: 19, last_post_date: localDateString(new Date(Date.now() - 86400000)) },
      { user_id: 'u-mike', current_streak: 2, longest_streak: 9, last_post_date: localDateString() },
    ],
    sessionUserId: null,
    credentials: [],
    notificationPrefs: { breakfast: true, lunch: true, dinner: true },
  };
}

export class MockService implements DataService {
  private db: Db | null = null;

  private async load(): Promise<Db> {
    if (this.db) return this.db;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      this.db = raw ? (JSON.parse(raw) as Db) : freshDb();
    } catch {
      this.db = freshDb();
    }
    return this.db;
  }

  private async save(): Promise<void> {
    if (this.db) await AsyncStorage.setItem(KEY, JSON.stringify(this.db));
  }

  private async me(): Promise<User> {
    const db = await this.load();
    const u = db.users.find((x) => x.id === db.sessionUserId);
    if (!u) throw new Error('Not signed in');
    return u;
  }

  private hydrate(db: Db, post: Post, meId: string): Post {
    return {
      ...post,
      user: db.users.find((u) => u.id === post.user_id),
      recipe: db.recipes.find((r) => r.post_id === post.id) ?? null,
      reaction_count: db.reactions.filter((r) => r.post_id === post.id).length,
      reacted_by_me: db.reactions.some((r) => r.post_id === post.id && r.user_id === meId),
      comment_count: db.comments.filter((c) => c.post_id === post.id).length,
      share_count: db.shares.filter((s) => s.post_id === post.id).length,
      repost_count: db.reposts.filter((r) => r.post_id === post.id).length,
      reposted_by_me: db.reposts.some((r) => r.post_id === post.id && r.user_id === meId),
      saved_by_me: db.saves.some((s) => s.post_id === post.id && s.user_id === meId),
      tagged: (db.postTags ?? [])
        .filter((t) => t.post_id === post.id)
        .map((t) => db.users.find((u) => u.id === t.user_id))
        .filter((u): u is User => Boolean(u)),
    };
  }

  async getCurrentUser(): Promise<User | null> {
    const db = await this.load();
    return db.users.find((u) => u.id === db.sessionUserId) ?? null;
  }

  async signUp(input: {
    email: string;
    password: string;
    handle: string;
    display_name: string;
    avatar_emoji?: string;
  }): Promise<SignUpResult> {
    const db = await this.load();
    const email = input.email.trim().toLowerCase();
    const handle = input.handle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, LIMITS.handle);
    if (!handle) throw new Error('Pick a handle (letters, numbers, underscores).');
    if (db.credentials.some((c) => c.email === email)) {
      throw new Error('That email already has an account. Sign in instead.');
    }
    if (db.users.some((u) => u.handle === handle)) {
      throw new Error('That handle is taken, try another.');
    }
    const user: User = {
      id: uid('u-'),
      handle,
      display_name: clamp(input.display_name, LIMITS.displayName) || handle,
      avatar_url: null,
      avatar_emoji: input.avatar_emoji ?? null,
      bio: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      created_at: new Date().toISOString(),
    };
    db.users.push(user);
    db.credentials.push({
      email,
      password_hash: await hashPassword(input.password),
      userId: user.id,
    });
    db.sessionUserId = user.id;
    // demo account follows the seed users so the feed is alive immediately
    for (const f of SEED_FOLLOWING) db.follows.push({ follower_id: user.id, followee_id: f });
    db.streaks.push({ user_id: user.id, current_streak: 0, longest_streak: 0, last_post_date: null });
    await this.save();
    // Demo mode has no email step, so an account is usable immediately.
    return { status: 'ready', user };
  }

  async signIn(email: string, password: string): Promise<User> {
    const db = await this.load();
    const cred = db.credentials.find((c) => c.email === email.trim().toLowerCase());
    let ok = false;
    if (cred?.password_hash) {
      ok = await verifyPassword(password, cred.password_hash);
    } else if (cred?.password !== undefined) {
      // Demo account created before hashing existed: accept once, then
      // upgrade and drop the plaintext so nobody is locked out.
      ok = cred.password === password;
      if (ok) {
        cred.password_hash = await hashPassword(password);
        delete cred.password;
      }
    }
    // One message either way, so this is never an account-existence oracle.
    if (!cred || !ok) throw new Error('Wrong email or password.');
    db.sessionUserId = cred.userId;
    await this.save();
    return (await this.getCurrentUser())!;
  }

  async signOut(): Promise<void> {
    const db = await this.load();
    db.sessionUserId = null;
    await this.save();
  }

  // Demo mode has no email delivery, so these password/confirmation flows are
  // no-ops here — the live backend (Supabase) does the real work.
  async requestPasswordReset(_email: string): Promise<void> {
    // Nothing to send in demo mode.
  }

  async resendConfirmation(_email: string): Promise<void> {
    // Demo accounts are usable immediately; nothing to resend.
  }

  async setSessionFromTokens(_accessToken: string, _refreshToken: string): Promise<void> {
    // No token-based sessions in demo mode.
  }

  async updatePassword(newPassword: string): Promise<void> {
    const db = await this.load();
    const cred = db.credentials.find((c) => c.userId === db.sessionUserId);
    if (!cred) throw new Error('Not signed in');
    cred.password_hash = await hashPassword(newPassword);
    delete cred.password;
    await this.save();
  }

  async deleteAccount(): Promise<void> {
    const db = await this.load();
    const meId = db.sessionUserId;
    if (!meId) return;
    db.users = db.users.filter((u) => u.id !== meId);
    const myPosts = new Set(db.posts.filter((p) => p.user_id === meId).map((p) => p.id));
    db.posts = db.posts.filter((p) => p.user_id !== meId);
    db.recipes = db.recipes.filter((r) => !myPosts.has(r.post_id));
    db.follows = db.follows.filter((f) => f.follower_id !== meId && f.followee_id !== meId);
    db.reactions = db.reactions.filter((r) => r.user_id !== meId && !myPosts.has(r.post_id));
    db.comments = db.comments.filter((c) => c.user_id !== meId && !myPosts.has(c.post_id));
    db.reposts = db.reposts.filter((r) => r.user_id !== meId && !myPosts.has(r.post_id));
    db.shares = db.shares.filter((s) => s.user_id !== meId && !myPosts.has(s.post_id));
    db.saves = db.saves.filter((s) => s.user_id !== meId && !myPosts.has(s.post_id));
    const { collections, collectionPosts } = this.colTables(db);
    const myCollections = new Set(collections.filter((c) => c.user_id === meId).map((c) => c.id));
    db.collections = collections.filter((c) => c.user_id !== meId);
    db.collectionPosts = collectionPosts.filter(
      (cp) => !myCollections.has(cp.collection_id) && !myPosts.has(cp.post_id),
    );
    db.messageReactions = (db.messageReactions ?? []).filter((r) => r.user_id !== meId);
    db.postTags = (db.postTags ?? []).filter((t) => t.user_id !== meId && !myPosts.has(t.post_id));
    db.streaks = db.streaks.filter((s) => s.user_id !== meId);
    db.credentials = db.credentials.filter((c) => c.userId !== meId);
    db.sessionUserId = null;
    await this.save();
  }

  async exportMyData(): Promise<string> {
    const db = await this.load();
    const me = await this.me();
    const myPosts = db.posts.filter((p) => p.user_id === me.id);
    const postIds = new Set(myPosts.map((p) => p.id));
    return JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        profile: me,
        posts: myPosts,
        recipes: db.recipes.filter((r) => postIds.has(r.post_id)),
        follows: db.follows.filter((f) => f.follower_id === me.id),
        reactions: db.reactions.filter((r) => r.user_id === me.id),
        comments: db.comments.filter((c) => c.user_id === me.id),
        reposts: db.reposts.filter((r) => r.user_id === me.id),
        collections: this.colTables(db)
          .collections.filter((c) => c.user_id === me.id)
          .map((c) => ({
            ...c,
            posts: this.colTables(db).collectionPosts.filter((cp) => cp.collection_id === c.id),
          })),
        streak: db.streaks.find((s) => s.user_id === me.id) ?? null,
      },
      null,
      2,
    );
  }

  async updateProfile(
    patch: Partial<
      Pick<User, 'display_name' | 'bio' | 'avatar_emoji' | 'avatar_url' | 'follows_private'>
    >,
  ): Promise<User> {
    const db = await this.load();
    const me = await this.me();
    // Replace with a NEW object (not an in-place mutation) so React sees a
    // fresh reference and re-renders the profile after a save.
    // Only these fields are writable, each bounded to match the DB.
    const safe: Partial<User> = {};
    if (patch.display_name !== undefined) {
      safe.display_name = clamp(patch.display_name, LIMITS.displayName) || me.handle;
    }
    if (patch.bio !== undefined) safe.bio = clampOrNull(patch.bio, LIMITS.bio);
    if (patch.avatar_emoji !== undefined) safe.avatar_emoji = clampOrNull(patch.avatar_emoji, 8);
    if (patch.avatar_url !== undefined) safe.avatar_url = patch.avatar_url ?? null;
    if (patch.follows_private !== undefined) safe.follows_private = Boolean(patch.follows_private);
    const updated: User = { ...me, ...safe };
    const idx = db.users.findIndex((u) => u.id === me.id);
    db.users[idx] = updated;
    await this.save();
    return updated;
  }

  async setAvatar(localUri: string): Promise<User> {
    // Demo mode has no storage bucket: keep the URI as-is. pickImage() already
    // converted web blob: URLs to data URLs so this survives a reload.
    return this.updateProfile({ avatar_url: localUri, avatar_emoji: null });
  }

  async listUsers(query?: string): Promise<User[]> {
    const db = await this.load();
    const meForBlocks = await this.me();
    const blockedU = this.blockedIds(db, meForBlocks.id);
    const q = (query ?? '').trim().toLowerCase();
    return db.users
      .filter((u) => u.id !== db.sessionUserId && !blockedU.has(u.id))
      .filter(
        (u) =>
          !q ||
          u.handle.toLowerCase().includes(q) ||
          u.display_name.toLowerCase().includes(q),
      );
  }

  async getFollowingIds(): Promise<string[]> {
    const db = await this.load();
    return db.follows.filter((f) => f.follower_id === db.sessionUserId).map((f) => f.followee_id);
  }

  async follow(userId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    if (!db.follows.some((f) => f.follower_id === me.id && f.followee_id === userId)) {
      db.follows.push({ follower_id: me.id, followee_id: userId });
      await this.save();
    }
  }

  async unfollow(userId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    db.follows = db.follows.filter((f) => !(f.follower_id === me.id && f.followee_id === userId));
    await this.save();
  }

  async getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
    const db = await this.load();
    return {
      followers: db.follows.filter((f) => f.followee_id === userId).length,
      following: db.follows.filter((f) => f.follower_id === userId).length,
    };
  }

  async getFollowers(userId: string): Promise<User[]> {
    const db = await this.load();
    const ids = db.follows.filter((f) => f.followee_id === userId).map((f) => f.follower_id);
    return db.users.filter((u) => ids.includes(u.id));
  }

  async getFollowingUsers(userId: string): Promise<User[]> {
    const db = await this.load();
    const ids = db.follows.filter((f) => f.follower_id === userId).map((f) => f.followee_id);
    return db.users.filter((u) => ids.includes(u.id));
  }

  async getFeed(): Promise<Post[]> {
    const db = await this.load();
    const me = await this.me();
    // Production hides blocked content via RLS; demo mode filters here so the
    // two behave identically.
    const blocked = this.blockedIds(db, me.id);
    const followed = new Set(await this.getFollowingIds());
    followed.add(me.id);
    return db.posts
      .filter((p) => followed.has(p.user_id) && !blocked.has(p.user_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => this.hydrate(db, p, me.id));
  }

  async getPost(postId: string): Promise<Post | null> {
    const db = await this.load();
    const me = await this.me();
    const post = db.posts.find((p) => p.id === postId);
    return post ? this.hydrate(db, post, me.id) : null;
  }

  async getDiscoverPosts(): Promise<Post[]> {
    const db = await this.load();
    const me = await this.me();
    // Everyone's posts, not just people you follow — that's the whole point of
    // Discover. Your own are excluded; you already know what you cooked.
    const blocked = this.blockedIds(db, me.id);
    return db.posts
      .filter((p) => p.user_id !== me.id && !blocked.has(p.user_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => this.hydrate(db, p, me.id));
  }

  async searchPosts(query: string): Promise<Post[]> {
    const db = await this.load();
    const me = await this.me();
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const blocked = this.blockedIds(db, me.id);
    return db.posts
      .filter((p) => {
        if (blocked.has(p.user_id)) return false;
        const recipe = db.recipes.find((r) => r.post_id === p.id);
        return (
          p.blurb.toLowerCase().includes(q) ||
          (recipe?.title ?? '').toLowerCase().includes(q) ||
          // Ingredients are the structured asset; searching them is the point.
          (recipe?.ingredients ?? []).some((i) => i.item.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => this.hydrate(db, p, me.id));
  }

  async getDiscoverPeople(): Promise<DiscoverPerson[]> {
    const db = await this.load();
    const me = await this.me();
    const following = new Set(
      db.follows.filter((f) => f.follower_id === me.id).map((f) => f.followee_id),
    );
    const blockedIds = this.blockedIds(db, me.id);
    return db.users
      .filter((u) => u.id !== me.id && !blockedIds.has(u.id))
      .map((u) => {
        const posts = db.posts
          .filter((p) => p.user_id === u.id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        return {
          user: u,
          posts: posts.slice(0, 3).map((p) => this.hydrate(db, p, me.id)),
          post_count: posts.length,
          is_following: following.has(u.id),
        };
      })
      // People you don't already follow first, then the most active.
      .sort((a, b) =>
        a.is_following === b.is_following
          ? b.post_count - a.post_count
          : Number(a.is_following) - Number(b.is_following),
      );
  }

  async getUserPosts(userId: string): Promise<Post[]> {
    const db = await this.load();
    const meId = db.sessionUserId ?? '';
    return db.posts
      .filter((p) => p.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => this.hydrate(db, p, meId));
  }

  async getReposts(userId: string): Promise<Post[]> {
    const db = await this.load();
    const meId = db.sessionUserId ?? '';
    return db.reposts
      .filter((r) => r.user_id === userId)
      .sort((a, b) => (b as any).created_at?.localeCompare?.((a as any).created_at) ?? 0)
      .map((r) => db.posts.find((p) => p.id === r.post_id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => this.hydrate(db, p, meId));
  }

  async createPost(input: NewPostInput): Promise<Post> {
    const db = await this.load();
    const me = await this.me();
    const post: Post = {
      id: uid('p-'),
      user_id: me.id,
      meal_slot: input.meal_slot,
      photo_url: input.photo_url,
      photo_emoji: input.photo_emoji ?? null,
      blurb: clamp(input.blurb, LIMITS.blurb),
      restaurant_place_id: input.restaurant?.place_id ?? null,
      restaurant_name: input.restaurant?.name ?? null,
      lat: input.restaurant?.lat ?? null,
      lng: input.restaurant?.lng ?? null,
      created_at: new Date().toISOString(),
    };
    db.posts.push(post);
    this.writeTags(db, me.id, post.id, input.tag_user_ids ?? []);
    if (input.recipe) {
      db.recipes.push({ ...input.recipe, id: uid('r-'), post_id: post.id });
    }
    // streak update
    const today = localDateString();
    let streak = db.streaks.find((s) => s.user_id === me.id);
    if (!streak) {
      streak = { user_id: me.id, current_streak: 0, longest_streak: 0, last_post_date: null };
      db.streaks.push(streak);
    }
    if (streak.last_post_date !== today) {
      const gap = streak.last_post_date ? daysBetween(streak.last_post_date, today) : Infinity;
      streak.current_streak = gap === 1 ? streak.current_streak + 1 : 1;
      streak.longest_streak = Math.max(streak.longest_streak, streak.current_streak);
      streak.last_post_date = today;
    }
    await this.save();
    return this.hydrate(db, post, me.id);
  }

  // ------------------------------------------------------ direct messages

  /** Older saved demo databases predate DMs; treat missing tables as empty. */
  private dmTables(db: Db) {
    if (!db.conversations) db.conversations = [];
    if (!db.conversationMembers) db.conversationMembers = [];
    if (!db.messages) db.messages = [];
    return db;
  }

  private hydrateMessage(db: Db, m: Message, meId: string): Message {
    return {
      ...m,
      shared_user: m.shared_user_id ? db.users.find((u) => u.id === m.shared_user_id) ?? null : null,
      reactions: (db.messageReactions ?? [])
        .filter((r) => r.message_id === m.id)
        .map(({ user_id, emoji }) => ({ user_id, emoji })),
      sender: db.users.find((u) => u.id === m.sender_id),
      shared_post: m.shared_post_id
        ? (() => {
            const p = db.posts.find((x) => x.id === m.shared_post_id);
            return p ? this.hydrate(db, p, meId) : null;
          })()
        : null,
    };
  }

  async getConversations(): Promise<Conversation[]> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    const mine = db.conversationMembers.filter((m) => m.user_id === me.id);

    return mine
      .map((membership) => {
        const conv = db.conversations.find((c) => c.id === membership.conversation_id);
        if (!conv) return null;
        const otherIds = db.conversationMembers
          .filter((m) => m.conversation_id === conv.id && m.user_id !== me.id)
          .map((m) => m.user_id);
        // If the other side left or deleted their account, keep the thread
        // visible with a placeholder rather than silently losing the history.
        const others: User[] =
          otherIds.length > 0
            ? otherIds.map(
                (id) =>
                  db.users.find((u) => u.id === id) ??
                  ({
                    id,
                    handle: 'unavailable',
                    display_name: 'Someone',
                    avatar_url: null,
                    avatar_emoji: null,
                    bio: null,
                    timezone: 'UTC',
                    created_at: conv.created_at,
                  } as User),
              )
            : [
                {
                  id: `gone-${conv.id}`,
                  handle: 'unavailable',
                  display_name: 'Someone',
                  avatar_url: null,
                  avatar_emoji: null,
                  bio: null,
                  timezone: 'UTC',
                  created_at: conv.created_at,
                } as User,
              ];

        const msgs = db.messages
          .filter((m) => m.conversation_id === conv.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const last = msgs.length ? msgs[msgs.length - 1] : null;
        return {
          id: conv.id,
          other: others[0],
          others,
          is_group: others.length > 1,
          title: (conv as any).title ?? null,
          last_message: last ? this.hydrateMessage(db, last, me.id) : null,
          // Unread = messages from others since I last opened it.
          unread_count: msgs.filter(
            (m) => m.sender_id !== me.id && m.created_at > membership.last_read_at,
          ).length,
          updated_at: conv.updated_at,
        } as Conversation;
      })
      .filter((c): c is Conversation => c !== null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    const isMember = db.conversationMembers.some(
      (m) => m.conversation_id === conversationId && m.user_id === me.id,
    );
    if (!isMember) throw new Error('Not part of that conversation.');
    return db.messages
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => this.hydrateMessage(db, m, me.id));
  }

  async reactToMessage(messageId: string, emoji: string | null): Promise<void> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    const msg = db.messages.find((m) => m.id === messageId);
    // Mirrors RLS: only people in the thread can react.
    const isMember =
      !!msg &&
      db.conversationMembers.some(
        (m) => m.conversation_id === msg.conversation_id && m.user_id === me.id,
      );
    if (!isMember) throw new Error('Not part of that conversation.');
    const rest = (db.messageReactions ?? []).filter(
      (r) => !(r.message_id === messageId && r.user_id === me.id),
    );
    db.messageReactions = emoji ? [...rest, { message_id: messageId, user_id: me.id, emoji }] : rest;
    await this.save();
  }

  /**
   * Make the post's tags exactly `userIds` (mirrors the post_tags RLS: no
   * self-tags, nobody across a block) and notify anyone newly tagged.
   */
  private writeTags(db: Db, meId: string, postId: string, userIds: string[]): void {
    const blocked = this.blockedIds(db, meId);
    const want = [...new Set(userIds)].filter(
      (id) => id !== meId && !blocked.has(id) && db.users.some((u) => u.id === id),
    );
    const had = new Set((db.postTags ?? []).filter((t) => t.post_id === postId).map((t) => t.user_id));
    db.postTags = [
      ...(db.postTags ?? []).filter((t) => t.post_id !== postId),
      ...want.map((user_id) => ({ post_id: postId, user_id })),
    ];
    if (!db.notifications) db.notifications = [];
    for (const id of want) {
      if (had.has(id)) continue;
      const already = db.notifications.some(
        (n) => n.user_id === id && n.actor_id === meId && n.type === 'tag' && n.post_id === postId,
      );
      if (already) continue;
      db.notifications.push({
        id: uid('n-'),
        user_id: id,
        actor_id: meId,
        type: 'tag',
        post_id: postId,
        comment_id: null,
        read_at: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  async setPostTags(postId: string, userIds: string[]): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const post = db.posts.find((p) => p.id === postId);
    if (!post || post.user_id !== me.id) throw new Error('You can only tag people in your own posts.');
    this.writeTags(db, me.id, postId, userIds);
    await this.save();
  }

  async sendMessage(
    conversationId: string,
    input: { text?: string; sharedPostId?: string; sharedUserId?: string; imageUri?: string },
  ): Promise<Message> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    const isMember = db.conversationMembers.some(
      (m) => m.conversation_id === conversationId && m.user_id === me.id,
    );
    if (!isMember) throw new Error('Not part of that conversation.');

    const text = (input.text ?? '').trim().slice(0, 2000);
    if (!text && !input.sharedPostId && !input.sharedUserId && !input.imageUri) {
      throw new Error('Nothing to send.');
    }

    const msg: Message = {
      id: uid('m-'),
      conversation_id: conversationId,
      sender_id: me.id,
      text,
      shared_post_id: input.sharedPostId ?? null,
      shared_user_id: input.sharedUserId ?? null,
      // Demo mode has no bucket: keep the URI as-is. pickImage already turned
      // web blob: URLs into data URLs so it survives a reload.
      image_url: input.imageUri ?? null,
      created_at: new Date().toISOString(),
    };
    db.messages.push(msg);
    const conv = db.conversations.find((c) => c.id === conversationId);
    if (conv) conv.updated_at = msg.created_at;
    await this.save();
    return this.hydrateMessage(db, msg, me.id);
  }

  async startConversation(userId: string): Promise<string> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    if (userId === me.id) throw new Error('You cannot message yourself.');

    // Reuse an existing strictly-1:1 thread (exactly the two of us) rather than
    // stacking duplicates — and never a group we happen to share.
    const existing = this.findConversationWithMembers(db, [me.id, userId]);
    if (existing) return existing;

    // DMs are opt-in: you can only open a thread with someone you follow.
    // The database enforces this in RLS; this mirrors it so demo mode behaves
    // the same and the user gets a sentence instead of a policy violation.
    const follows = db.follows.some(
      (f) => f.follower_id === me.id && f.followee_id === userId,
    );
    if (!follows) {
      throw new Error('You can only message people you follow. Follow them first.');
    }

    const now = new Date().toISOString();
    const id = uid('conv-');
    db.conversations.push({ id, created_at: now, updated_at: now });
    db.conversationMembers.push({ conversation_id: id, user_id: me.id, last_read_at: now });
    db.conversationMembers.push({ conversation_id: id, user_id: userId, last_read_at: '1970-01-01T00:00:00.000Z' });
    await this.save();
    return id;
  }

  async startGroupConversation(userIds: string[]): Promise<string> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    const targets = [...new Set(userIds)].filter((id) => id && id !== me.id);
    if (targets.length < 1) throw new Error('Pick at least one person to message.');

    for (const t of targets) {
      const follows = db.follows.some((f) => f.follower_id === me.id && f.followee_id === t);
      if (!follows) {
        throw new Error('You can only message people you follow. Follow them first.');
      }
    }

    const wanted = [me.id, ...targets];
    const existing = this.findConversationWithMembers(db, wanted);
    if (existing) return existing;

    const now = new Date().toISOString();
    const id = uid('conv-');
    db.conversations.push({ id, created_at: now, updated_at: now });
    db.conversationMembers.push({ conversation_id: id, user_id: me.id, last_read_at: now });
    for (const t of targets) {
      db.conversationMembers.push({
        conversation_id: id,
        user_id: t,
        last_read_at: '1970-01-01T00:00:00.000Z',
      });
    }
    await this.save();
    return id;
  }

  /** Find a thread whose member set is exactly `memberIds` (order-independent). */
  private findConversationWithMembers(
    db: ReturnType<MockService['dmTables']>,
    memberIds: string[],
  ): string | null {
    const want = [...new Set(memberIds)].sort().join(',');
    const byConv = new Map<string, string[]>();
    for (const m of db.conversationMembers) {
      const list = byConv.get(m.conversation_id) ?? [];
      list.push(m.user_id);
      byConv.set(m.conversation_id, list);
    }
    for (const [convId, ids] of byConv) {
      if ([...new Set(ids)].sort().join(',') === want) return convId;
    }
    return null;
  }

  async sendFeedback(input: { kind: FeedbackKind; message: string }): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const message = clamp(input.message, 2000);
    if (!message) throw new Error('Please tell us what happened.');
    if (!db.feedback) db.feedback = [];
    db.feedback.push({
      id: uid('fb-'),
      user_id: me.id,
      handle_snapshot: me.handle,
      kind: input.kind,
      message,
      app_version: appVersion(),
      platform: platformName(),
      status: 'new',
      created_at: new Date().toISOString(),
    });
    await this.save();
  }

  async reportMessage(messageId: string, reason: ReportReason, detail?: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const dm = this.dmTables(db);
    const msg = dm.messages.find((m) => m.id === messageId);
    if (!msg) throw new Error('That message no longer exists.');
    if (msg.sender_id === me.id) throw new Error('You cannot report your own message.');

    // Filing twice is a no-op, same as post reports.
    if (db.reports.some((r) => r.message_id === messageId && r.reporter_id === me.id)) return;

    db.reports.push({
      id: uid('rep-'),
      post_id: null,
      message_id: messageId,
      reporter_id: me.id,
      reported_user_id: msg.sender_id,
      reason,
      detail: detail?.trim() ? detail.trim().slice(0, 1000) : null,
      post_blurb_snapshot: null,
      post_photo_url_snapshot: null,
      // Snapshot the message: the sender can delete it, and the report has to
      // still show a reviewer what was actually reported.
      message_text_snapshot: msg.text || null,
      message_image_url_snapshot: msg.image_url ?? null,
      status: 'open',
      created_at: new Date().toISOString(),
      reviewed_at: null,
      reviewer_notes: null,
    } as any);
    await this.save();
  }

  async reportComment(commentId: string, reason: ReportReason, detail?: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const comment = db.comments.find((c) => c.id === commentId);
    if (!comment) throw new Error('That comment no longer exists.');
    if (comment.user_id === me.id) throw new Error('You cannot report your own comment.');

    // Filing twice is a no-op, same as post and message reports.
    if (db.reports.some((r) => r.comment_id === commentId && r.reporter_id === me.id)) return;

    db.reports.push({
      id: uid('rep-'),
      post_id: null,
      comment_id: commentId,
      reporter_id: me.id,
      reported_user_id: comment.user_id,
      reason,
      detail: detail?.trim() ? detail.trim().slice(0, 1000) : null,
      post_blurb_snapshot: null,
      post_photo_url_snapshot: null,
      // Snapshot the comment: the author can delete it, and the report has to
      // still show a reviewer what was actually reported.
      comment_text_snapshot: comment.text || null,
      status: 'open',
      created_at: new Date().toISOString(),
      reviewed_at: null,
      reviewer_notes: null,
    } as any);
    await this.save();
  }

  async reportUser(userId: string, reason: ReportReason, detail?: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    if (userId === me.id) throw new Error('You cannot report your own account.');

    // One standing account report per reporter is plenty; more just buries the
    // queue. An account report carries no content id — reported_user_id is it.
    if (
      db.reports.some(
        (r) =>
          r.reported_user_id === userId &&
          r.reporter_id === me.id &&
          !r.post_id &&
          !r.message_id &&
          !r.comment_id,
      )
    ) {
      return;
    }

    db.reports.push({
      id: uid('rep-'),
      post_id: null,
      reporter_id: me.id,
      reported_user_id: userId,
      reason,
      detail: detail?.trim() ? detail.trim().slice(0, 1000) : null,
      post_blurb_snapshot: null,
      post_photo_url_snapshot: null,
      status: 'open',
      created_at: new Date().toISOString(),
      reviewed_at: null,
      reviewer_notes: null,
    } as any);
    await this.save();
  }

  async sharePostToUsers(postId: string, userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      const convId = await this.startConversation(userId);
      await this.sendMessage(convId, { sharedPostId: postId });
    }
  }

  async sharePostToGroup(postId: string, userIds: string[]): Promise<void> {
    const convId = await this.startGroupConversation(userIds);
    await this.sendMessage(convId, { sharedPostId: postId });
  }

  async shareProfileToUsers(profileId: string, userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      const convId = await this.startConversation(userId);
      await this.sendMessage(convId, { sharedUserId: profileId });
    }
  }

  async shareProfileToGroup(profileId: string, userIds: string[]): Promise<void> {
    const convId = await this.startGroupConversation(userIds);
    await this.sendMessage(convId, { sharedUserId: profileId });
  }

  async renameConversation(conversationId: string, title: string): Promise<void> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    const isMember = db.conversationMembers.some(
      (m) => m.conversation_id === conversationId && m.user_id === me.id,
    );
    if (!isMember) throw new Error('Not part of that conversation.');
    const trimmed = title.trim().slice(0, 60);
    const conv = db.conversations.find((c) => c.id === conversationId);
    if (conv) (conv as any).title = trimmed.length ? trimmed : null;
    await this.save();
  }

  async getConversationMembers(conversationId: string): Promise<User[]> {
    const db = this.dmTables(await this.load());
    return db.conversationMembers
      .filter((m) => m.conversation_id === conversationId)
      .map((m) => db.users.find((u) => u.id === m.user_id))
      .filter((u): u is User => Boolean(u));
  }

  async getConversationMuted(conversationId: string): Promise<boolean> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    return Boolean(
      db.conversationMembers.find(
        (m) => m.conversation_id === conversationId && m.user_id === me.id,
      )?.muted,
    );
  }

  async setConversationMuted(conversationId: string, muted: boolean): Promise<void> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    const row = db.conversationMembers.find(
      (m) => m.conversation_id === conversationId && m.user_id === me.id,
    );
    if (row) row.muted = muted;
    await this.save();
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    // Leave, don't destroy: drop only my membership so the thread disappears
    // from my inbox while the other person keeps theirs.
    db.conversationMembers = db.conversationMembers.filter(
      (m) => !(m.conversation_id === conversationId && m.user_id === me.id),
    );
    await this.save();
  }

  async markConversationRead(conversationId: string): Promise<void> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    const membership = db.conversationMembers.find(
      (m) => m.conversation_id === conversationId && m.user_id === me.id,
    );
    if (!membership) return;
    membership.last_read_at = new Date().toISOString();
    await this.save();
  }

  async getUnreadCount(): Promise<number> {
    const convs = await this.getConversations();
    return convs.reduce((sum, c) => sum + c.unread_count, 0);
  }

  async savePushToken(): Promise<void> {
    // Demo mode has no server to push from.
  }

  // ------------------------------------------------------------- blocking

  /** Either direction counts: a block hides content both ways. */
  private blockedPair(db: Db, a: string, b: string): boolean {
    return (db.blocks ?? []).some(
      (x) =>
        (x.blocker_id === a && x.blocked_id === b) ||
        (x.blocker_id === b && x.blocked_id === a),
    );
  }

  /** Ids the signed-in user should never see content from. */
  private blockedIds(db: Db, meId: string): Set<string> {
    const out = new Set<string>();
    for (const x of db.blocks ?? []) {
      if (x.blocker_id === meId) out.add(x.blocked_id);
      if (x.blocked_id === meId) out.add(x.blocker_id);
    }
    return out;
  }

  async blockUser(userId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    if (userId === me.id) throw new Error('You cannot block yourself.');
    if (!db.blocks) db.blocks = [];
    if (!db.blocks.some((x) => x.blocker_id === me.id && x.blocked_id === userId)) {
      db.blocks.push({ blocker_id: me.id, blocked_id: userId });
    }
    // Blocking severs the relationship in both directions.
    db.follows = db.follows.filter(
      (f) =>
        !(f.follower_id === me.id && f.followee_id === userId) &&
        !(f.follower_id === userId && f.followee_id === me.id),
    );
    await this.save();
  }

  async unblockUser(userId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    db.blocks = (db.blocks ?? []).filter(
      (x) => !(x.blocker_id === me.id && x.blocked_id === userId),
    );
    await this.save();
  }

  async getBlockedUsers(): Promise<User[]> {
    const db = await this.load();
    const me = await this.me();
    const ids = (db.blocks ?? [])
      .filter((x) => x.blocker_id === me.id)
      .map((x) => x.blocked_id);
    return db.users.filter((u) => ids.includes(u.id));
  }

  async isBlocked(userId: string): Promise<boolean> {
    const db = await this.load();
    const me = await this.me();
    return this.blockedPair(db, me.id, userId);
  }

  async reportPost(postId: string, reason: ReportReason, detail?: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const post = db.posts.find((p) => p.id === postId);
    if (!post) throw new Error('That post no longer exists.');
    if (post.user_id === me.id) throw new Error('You cannot report your own post.');

    // Filing twice is a no-op, so the UI can stay simple and the queue doesn't
    // fill with duplicates from one person repeatedly tapping Report.
    const already = db.reports.some((r) => r.post_id === postId && r.reporter_id === me.id);
    if (already) return;

    db.reports.push({
      id: uid('rep-'),
      post_id: postId,
      reporter_id: me.id,
      reported_user_id: post.user_id,
      reason,
      detail: detail?.trim() ? detail.trim().slice(0, 1000) : null,
      // Snapshot the content: if the author deletes the post, the report must
      // still show a reviewer what was actually reported.
      post_blurb_snapshot: post.blurb ?? null,
      post_photo_url_snapshot: post.photo_url ?? null,
      status: 'open',
      created_at: new Date().toISOString(),
      reviewed_at: null,
      reviewer_notes: null,
    });
    await this.save();
  }

  async deletePost(postId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const post = db.posts.find((p) => p.id === postId);
    // Only the author can delete. Silently ignoring a mismatch would hide bugs,
    // and in production this same check is enforced by RLS.
    if (!post || post.user_id !== me.id) throw new Error('You can only delete your own posts.');

    db.posts = db.posts.filter((p) => p.id !== postId);
    // Everything hanging off the post goes with it, so no orphans are left
    // inflating counts or showing up in someone's saved list.
    db.recipes = db.recipes.filter((r) => r.post_id !== postId);
    db.reactions = db.reactions.filter((r) => r.post_id !== postId);
    const goneCommentIds = new Set(
      db.comments.filter((c) => c.post_id === postId).map((c) => c.id),
    );
    db.comments = db.comments.filter((c) => c.post_id !== postId);
    db.commentReactions = (db.commentReactions ?? []).filter(
      (r) => !goneCommentIds.has(r.comment_id),
    );
    db.reposts = db.reposts.filter((r) => r.post_id !== postId);
    db.shares = db.shares.filter((s) => s.post_id !== postId);
    db.saves = db.saves.filter((s) => s.post_id !== postId);
    db.collectionPosts = this.colTables(db).collectionPosts.filter((cp) => cp.post_id !== postId);
    db.postTags = (db.postTags ?? []).filter((t) => t.post_id !== postId);
    // Reports are NOT deleted with the post — mirrors ON DELETE SET NULL in
    // schema.sql. Deleting a reported post must not erase the moderation
    // record; the snapshot on the report preserves what was reported.
    db.reports = db.reports.map((r) => (r.post_id === postId ? { ...r, post_id: null } : r));
    await this.save();
  }

  /**
   * Record "someone interacted with your post".
   *
   * Production writes these with a database trigger so a patched client can't
   * forge them (see supabase/schema.sql). Demo mode has no database, so this
   * mirrors the same rules: never notify yourself, never notify across a
   * block, and one row per person per post for like/repost/share so unliking
   * and re-liking doesn't stack duplicates.
   */
  private notify(
    db: Db,
    actorId: string,
    type: AppNotification['type'],
    postId: string,
    commentId?: string,
  ): void {
    if (!db.notifications) db.notifications = [];
    const owner = db.posts.find((p) => p.id === postId)?.user_id;
    if (!owner || owner === actorId) return;
    if (this.blockedIds(db, owner).has(actorId)) return;

    if (!commentId) {
      const already = db.notifications.some(
        (n) => n.user_id === owner && n.actor_id === actorId && n.type === type && n.post_id === postId,
      );
      if (already) return;
    }

    db.notifications.push({
      id: uid('n-'),
      user_id: owner,
      actor_id: actorId,
      type,
      post_id: postId,
      comment_id: commentId ?? null,
      read_at: null,
      created_at: new Date().toISOString(),
    });
  }

  async getNotifications(): Promise<AppNotification[]> {
    const db = await this.load();
    const me = await this.me();
    const blocked = this.blockedIds(db, me.id);
    return (db.notifications ?? [])
      .filter((n) => n.user_id === me.id && !blocked.has(n.actor_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((n) => ({
        ...n,
        actor: db.users.find((u) => u.id === n.actor_id),
        post: db.posts.find((p) => p.id === n.post_id) ?? null,
        comment_text: db.comments.find((c) => c.id === n.comment_id)?.text ?? null,
      }));
  }

  async getUnreadNotificationCount(): Promise<number> {
    const db = await this.load();
    const me = await this.me();
    const blocked = this.blockedIds(db, me.id);
    return (db.notifications ?? []).filter(
      (n) => n.user_id === me.id && !n.read_at && !blocked.has(n.actor_id),
    ).length;
  }

  async markNotificationsRead(): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const now = new Date().toISOString();
    let changed = false;
    for (const n of db.notifications ?? []) {
      if (n.user_id === me.id && !n.read_at) {
        n.read_at = now;
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  async clearNotifications(): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    db.notifications = (db.notifications ?? []).filter((n) => n.user_id !== me.id);
    await this.save();
  }

  async deleteNotifications(ids: string[]): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const drop = new Set(ids);
    // Mirrors RLS: only your own can go.
    db.notifications = (db.notifications ?? []).filter(
      (n) => !(n.user_id === me.id && drop.has(n.id)),
    );
    await this.save();
  }

  async toggleReaction(postId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const idx = db.reactions.findIndex((r) => r.post_id === postId && r.user_id === me.id);
    if (idx >= 0) db.reactions.splice(idx, 1);
    else {
      db.reactions.push({ post_id: postId, user_id: me.id });
      this.notify(db, me.id, 'like', postId);
    }
    await this.save();
  }

  async getComments(postId: string, limit = 15, offset = 0): Promise<Comment[]> {
    const db = await this.load();
    const me = await this.me();
    const blockedC = this.blockedIds(db, me.id);
    const top = db.comments
      .filter((c) => c.post_id === postId && !c.parent_id && !blockedC.has(c.user_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(offset, offset + limit);
    return top.map((c) => this.hydrateMockComment(db, me.id, c));
  }

  async getReplies(parentId: string): Promise<Comment[]> {
    const db = await this.load();
    const me = await this.me();
    const blockedC = this.blockedIds(db, me.id);
    return db.comments
      .filter((c) => c.parent_id === parentId && !blockedC.has(c.user_id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => this.hydrateMockComment(db, me.id, c));
  }

  private hydrateMockComment(db: any, meId: string, c: Comment): Comment {
    const likes = db.commentReactions ?? [];
    const postOwnerId = db.posts.find((p: any) => p.id === c.post_id)?.user_id;
    return {
      ...c,
      user: db.users.find((u: any) => u.id === c.user_id),
      like_count: likes.filter((r: any) => r.comment_id === c.id).length,
      liked_by_me: likes.some((r: any) => r.comment_id === c.id && r.user_id === meId),
      can_delete: c.user_id === meId || postOwnerId === meId,
      reply_count: db.comments.filter((x: any) => x.parent_id === c.id).length,
    };
  }

  async deleteComment(commentId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const comment = db.comments.find((c) => c.id === commentId);
    if (!comment) return;
    const postOwnerId = db.posts.find((p) => p.id === comment.post_id)?.user_id;
    if (comment.user_id !== me.id && postOwnerId !== me.id) {
      throw new Error('You cannot delete that comment.');
    }
    db.comments = db.comments.filter((c) => c.id !== commentId);
    db.commentReactions = (db.commentReactions ?? []).filter(
      (r) => r.comment_id !== commentId,
    );
    await this.save();
  }

  async toggleCommentLike(commentId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    if (!db.commentReactions) db.commentReactions = [];
    const idx = db.commentReactions.findIndex(
      (r) => r.comment_id === commentId && r.user_id === me.id,
    );
    if (idx >= 0) db.commentReactions.splice(idx, 1);
    else db.commentReactions.push({ comment_id: commentId, user_id: me.id });
    await this.save();
  }

  async getCommentLikers(commentId: string): Promise<User[]> {
    const db = await this.load();
    const ids = (db.commentReactions ?? [])
      .filter((r) => r.comment_id === commentId)
      .map((r) => r.user_id);
    return ids.map((id) => db.users.find((u) => u.id === id)).filter(Boolean) as User[];
  }

  async addComment(
    postId: string,
    text: string,
    imageUri?: string,
    parentId?: string | null,
  ): Promise<Comment> {
    const db = await this.load();
    const me = await this.me();
    const comment: Comment = {
      id: uid('c-'),
      post_id: postId,
      user_id: me.id,
      text: clamp(text, LIMITS.comment),
      image_url: imageUri ?? null,
      parent_id: parentId ?? null,
      created_at: new Date().toISOString(),
    };
    db.comments.push(comment);
    this.notify(db, me.id, 'comment', postId, comment.id);
    await this.save();
    return { ...comment, user: me };
  }

  async toggleRepost(postId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const idx = db.reposts.findIndex((r) => r.post_id === postId && r.user_id === me.id);
    if (idx >= 0) db.reposts.splice(idx, 1);
    else {
      db.reposts.push({ post_id: postId, user_id: me.id });
      this.notify(db, me.id, 'repost', postId);
    }
    await this.save();
  }

  async recordShare(postId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    // one share record per user per post keeps the count honest and idempotent
    if (!db.shares.some((s) => s.post_id === postId && s.user_id === me.id)) {
      db.shares.push({ post_id: postId, user_id: me.id });
      this.notify(db, me.id, 'share', postId);
      await this.save();
    }
  }

  // ---------------------------------------------------------- collections

  /** Demo databases saved before collections existed get the seed ones. */
  private colTables(db: Db) {
    if (!db.collections) db.collections = [...SEED_COLLECTIONS];
    if (!db.collectionPosts) db.collectionPosts = [...SEED_COLLECTION_POSTS];
    return { collections: db.collections, collectionPosts: db.collectionPosts };
  }

  private collectionOut(
    db: Db,
    c: { id: string; user_id: string; name: string; created_at: string },
    meId: string,
  ): Collection {
    const items = this.colTables(db)
      .collectionPosts.filter((cp) => cp.collection_id === c.id)
      .sort((a, b) => b.added_at.localeCompare(a.added_at))
      .map((cp) => db.posts.find((p) => p.id === cp.post_id))
      .filter((p): p is Post => Boolean(p));
    return {
      ...c,
      post_count: items.length,
      cover: items[0] ? this.hydrate(db, items[0], meId) : null,
    };
  }

  private myCollection(db: Db, meId: string, collectionId: string) {
    const c = this.colTables(db).collections.find((x) => x.id === collectionId);
    // Mirrors RLS: only the owner can change a collection.
    if (!c || c.user_id !== meId) throw new Error('You can only change your own collections.');
    return c;
  }

  async getCollections(userId: string): Promise<Collection[]> {
    const db = await this.load();
    const meId = db.sessionUserId ?? '';
    return this.colTables(db)
      .collections.filter((c) => c.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((c) => this.collectionOut(db, c, meId));
  }

  async getCollection(collectionId: string): Promise<Collection | null> {
    const db = await this.load();
    const c = this.colTables(db).collections.find((x) => x.id === collectionId);
    return c ? this.collectionOut(db, c, db.sessionUserId ?? '') : null;
  }

  async getCollectionPosts(collectionId: string): Promise<Post[]> {
    const db = await this.load();
    const meId = db.sessionUserId ?? '';
    return this.colTables(db)
      .collectionPosts.filter((cp) => cp.collection_id === collectionId)
      .sort((a, b) => b.added_at.localeCompare(a.added_at))
      .map((cp) => db.posts.find((p) => p.id === cp.post_id))
      .filter((p): p is Post => Boolean(p))
      .map((p) => this.hydrate(db, p, meId));
  }

  async createCollection(name: string): Promise<Collection> {
    const db = await this.load();
    const me = await this.me();
    const { collections } = this.colTables(db);
    const mine = collections.filter((c) => c.user_id === me.id).map((c) => c.name);
    const problem = collectionNameProblem(name, mine);
    if (problem) throw new Error(problem);
    const row = {
      id: uid('col-'),
      user_id: me.id,
      name: tidyCollectionName(name),
      created_at: new Date().toISOString(),
    };
    collections.push(row);
    await this.save();
    return this.collectionOut(db, row, me.id);
  }

  async renameCollection(collectionId: string, name: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const c = this.myCollection(db, me.id, collectionId);
    const others = this.colTables(db)
      .collections.filter((x) => x.user_id === me.id && x.id !== collectionId)
      .map((x) => x.name);
    const problem = collectionNameProblem(name, others);
    if (problem) throw new Error(problem);
    c.name = tidyCollectionName(name);
    await this.save();
  }

  async deleteCollection(collectionId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    this.myCollection(db, me.id, collectionId);
    const t = this.colTables(db);
    db.collections = t.collections.filter((c) => c.id !== collectionId);
    db.collectionPosts = t.collectionPosts.filter((cp) => cp.collection_id !== collectionId);
    await this.save();
  }

  async getPostCollectionIds(postId: string): Promise<string[]> {
    const db = await this.load();
    const me = await this.me();
    const { collections, collectionPosts } = this.colTables(db);
    const mine = new Set(collections.filter((c) => c.user_id === me.id).map((c) => c.id));
    return collectionPosts
      .filter((cp) => cp.post_id === postId && mine.has(cp.collection_id))
      .map((cp) => cp.collection_id);
  }

  async setPostInCollection(collectionId: string, postId: string, inside: boolean): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    this.myCollection(db, me.id, collectionId);
    const post = db.posts.find((p) => p.id === postId);
    if (!post || post.user_id !== me.id) throw new Error('Only your own posts can go in your collections.');
    const t = this.colTables(db);
    const has = t.collectionPosts.some((cp) => cp.collection_id === collectionId && cp.post_id === postId);
    if (inside && !has) {
      t.collectionPosts.push({ collection_id: collectionId, post_id: postId, added_at: new Date().toISOString() });
    } else if (!inside && has) {
      db.collectionPosts = t.collectionPosts.filter(
        (cp) => !(cp.collection_id === collectionId && cp.post_id === postId),
      );
    }
    await this.save();
  }

  async toggleSave(postId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const idx = db.saves.findIndex((s) => s.post_id === postId && s.user_id === me.id);
    if (idx >= 0) db.saves.splice(idx, 1);
    else db.saves.push({ post_id: postId, user_id: me.id });
    await this.save();
  }

  async getSavedPosts(): Promise<Post[]> {
    const db = await this.load();
    const me = await this.me();
    // most recently saved first (saves are pushed in save order)
    const myPostIds = db.saves
      .filter((s) => s.user_id === me.id)
      .map((s) => s.post_id)
      .reverse();
    const byId = new Map(db.posts.map((p) => [p.id, p]));
    return myPostIds
      .map((id) => byId.get(id))
      .filter((p): p is Post => Boolean(p))
      .map((p) => this.hydrate(db, p, me.id));
  }

  async getTaggedPosts(userId?: string): Promise<Post[]> {
    const db = await this.load();
    const me = await this.me();
    const who = userId ?? me.id;
    const blocked = this.blockedIds(db, me.id);
    // Tags have no timestamp in demo mode; newest post first stands in.
    const ids = new Set((db.postTags ?? []).filter((t) => t.user_id === who).map((t) => t.post_id));
    return db.posts
      // Mirrors RLS: posts from someone you've blocked (either way) stay hidden.
      .filter((p) => ids.has(p.id) && !blocked.has(p.user_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => this.hydrate(db, p, me.id));
  }

  async untagMe(postId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    db.postTags = (db.postTags ?? []).filter((t) => !(t.post_id === postId && t.user_id === me.id));
    await this.save();
  }

  async getLikedPosts(): Promise<Post[]> {
    const db = await this.load();
    const me = await this.me();
    // Reactions have no timestamp in demo mode, so fall back to post recency.
    const liked = new Set(
      db.reactions.filter((r) => r.user_id === me.id).map((r) => r.post_id),
    );
    return db.posts
      .filter((p) => liked.has(p.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => this.hydrate(db, p, me.id));
  }

  async getCommentedPosts(): Promise<Post[]> {
    const db = await this.load();
    const me = await this.me();
    // Newest comment first, one row per post even if I commented repeatedly.
    const mine = db.comments
      .filter((c) => c.user_id === me.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const seen = new Set<string>();
    const out: Post[] = [];
    for (const c of mine) {
      if (seen.has(c.post_id)) continue;
      seen.add(c.post_id);
      const post = db.posts.find((p) => p.id === c.post_id);
      if (post) out.push(this.hydrate(db, post, me.id));
    }
    return out;
  }

  async getStreak(userId: string): Promise<Streak> {
    const db = await this.load();
    const s = db.streaks.find((x) => x.user_id === userId);
    if (!s) return { user_id: userId, current_streak: 0, longest_streak: 0, last_post_date: null };
    // a streak lapses if the last post was more than 1 day ago
    if (s.last_post_date && daysBetween(s.last_post_date, localDateString()) > 1) {
      s.current_streak = 0;
    }
    return s;
  }

  async getLeaderboard(scope: LeaderboardScope): Promise<LeaderboardEntry[]> {
    const db = await this.load();
    const me = await this.me();
    const today = localDateString();

    let pool = db.users;
    if (scope === 'friends') {
      const following = new Set(
        db.follows.filter((f) => f.follower_id === me.id).map((f) => f.followee_id),
      );
      // You're always on your own friends board — a leaderboard you can't
      // place on is useless.
      pool = db.users.filter((u) => u.id === me.id || following.has(u.id));
    }

    return rankEntries(
      pool.map((u) => {
        const s = db.streaks.find((x) => x.user_id === u.id);
        // Apply the same lapse rule getStreak uses, so the board can't show a
        // stale streak someone stopped keeping.
        const lapsed =
          !s?.last_post_date || daysBetween(s.last_post_date, today) > 1;
        return {
          user: u,
          current_streak: lapsed ? 0 : s?.current_streak ?? 0,
          longest_streak: s?.longest_streak ?? 0,
          is_me: u.id === me.id,
        };
      }),
    );
  }

  async getNotificationPrefs(): Promise<NotificationPrefs> {
    const db = await this.load();
    return db.notificationPrefs;
  }

  async setNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
    const db = await this.load();
    db.notificationPrefs = prefs;
    await this.save();
  }
}
