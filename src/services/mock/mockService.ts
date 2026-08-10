import AsyncStorage from '@react-native-async-storage/async-storage';
import { uid } from '../../lib/id';
import { daysBetween, localDateString } from '../../lib/time';
import {
  Comment,
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
  SEED_COMMENTS,
  SEED_FOLLOWING,
  SEED_FOLLOWS,
  SEED_POSTS,
  SEED_REACTIONS,
  SEED_REPOSTS,
  SEED_SHARES,
  SEED_USERS,
} from './seed';

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
  commentReactions: { comment_id: string; user_id: string }[];
  conversations: { id: string; created_at: string; updated_at: string }[];
  conversationMembers: { conversation_id: string; user_id: string; last_read_at: string }[];
  messages: Message[];
  reports: Report[];
  streaks: Streak[];
  sessionUserId: string | null;
  credentials: { email: string; password: string; userId: string }[];
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
    commentReactions: [],
    conversations: [],
    conversationMembers: [],
    messages: [],
    reports: [],
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
  }): Promise<User> {
    const db = await this.load();
    const email = input.email.trim().toLowerCase();
    const handle = input.handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
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
      display_name: input.display_name.trim() || handle,
      avatar_url: null,
      avatar_emoji: input.avatar_emoji ?? null,
      bio: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      created_at: new Date().toISOString(),
    };
    db.users.push(user);
    db.credentials.push({ email, password: input.password, userId: user.id });
    db.sessionUserId = user.id;
    // demo account follows the seed users so the feed is alive immediately
    for (const f of SEED_FOLLOWING) db.follows.push({ follower_id: user.id, followee_id: f });
    db.streaks.push({ user_id: user.id, current_streak: 0, longest_streak: 0, last_post_date: null });
    await this.save();
    return user;
  }

  async signIn(email: string, password: string): Promise<User> {
    const db = await this.load();
    const cred = db.credentials.find((c) => c.email === email.trim().toLowerCase());
    if (!cred || cred.password !== password) throw new Error('Wrong email or password.');
    db.sessionUserId = cred.userId;
    await this.save();
    return (await this.getCurrentUser())!;
  }

  async signOut(): Promise<void> {
    const db = await this.load();
    db.sessionUserId = null;
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
    const updated: User = { ...me, ...patch };
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
    const q = (query ?? '').trim().toLowerCase();
    return db.users
      .filter((u) => u.id !== db.sessionUserId)
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
    const followed = new Set(await this.getFollowingIds());
    followed.add(me.id);
    return db.posts
      .filter((p) => followed.has(p.user_id))
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
    return db.posts
      .filter((p) => p.user_id !== me.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => this.hydrate(db, p, me.id));
  }

  async getDiscoverPeople(): Promise<DiscoverPerson[]> {
    const db = await this.load();
    const me = await this.me();
    const following = new Set(
      db.follows.filter((f) => f.follower_id === me.id).map((f) => f.followee_id),
    );
    return db.users
      .filter((u) => u.id !== me.id)
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

  async createPost(input: NewPostInput): Promise<Post> {
    const db = await this.load();
    const me = await this.me();
    const post: Post = {
      id: uid('p-'),
      user_id: me.id,
      meal_slot: input.meal_slot,
      photo_url: input.photo_url,
      photo_emoji: input.photo_emoji ?? null,
      blurb: input.blurb,
      restaurant_place_id: input.restaurant?.place_id ?? null,
      restaurant_name: input.restaurant?.name ?? null,
      lat: input.restaurant?.lat ?? null,
      lng: input.restaurant?.lng ?? null,
      created_at: new Date().toISOString(),
    };
    db.posts.push(post);
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
        const otherId = db.conversationMembers.find(
          (m) => m.conversation_id === conv.id && m.user_id !== me.id,
        )?.user_id;
        const other = db.users.find((u) => u.id === otherId);
        if (!other) return null; // other party deleted their account

        const msgs = db.messages
          .filter((m) => m.conversation_id === conv.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const last = msgs.length ? msgs[msgs.length - 1] : null;
        return {
          id: conv.id,
          other,
          last_message: last ? this.hydrateMessage(db, last, me.id) : null,
          // Unread = messages from the other person since I last opened it.
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

  async sendMessage(
    conversationId: string,
    input: { text?: string; sharedPostId?: string },
  ): Promise<Message> {
    const db = this.dmTables(await this.load());
    const me = await this.me();
    const isMember = db.conversationMembers.some(
      (m) => m.conversation_id === conversationId && m.user_id === me.id,
    );
    if (!isMember) throw new Error('Not part of that conversation.');

    const text = (input.text ?? '').trim().slice(0, 2000);
    if (!text && !input.sharedPostId) throw new Error('Nothing to send.');

    const msg: Message = {
      id: uid('m-'),
      conversation_id: conversationId,
      sender_id: me.id,
      text,
      shared_post_id: input.sharedPostId ?? null,
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

    // Reuse the existing 1:1 thread rather than stacking duplicates.
    const mine = new Set(
      db.conversationMembers.filter((m) => m.user_id === me.id).map((m) => m.conversation_id),
    );
    const existing = db.conversationMembers.find(
      (m) => m.user_id === userId && mine.has(m.conversation_id),
    );
    if (existing) return existing.conversation_id;

    const now = new Date().toISOString();
    const id = uid('conv-');
    db.conversations.push({ id, created_at: now, updated_at: now });
    db.conversationMembers.push({ conversation_id: id, user_id: me.id, last_read_at: now });
    db.conversationMembers.push({ conversation_id: id, user_id: userId, last_read_at: '1970-01-01T00:00:00.000Z' });
    await this.save();
    return id;
  }

  async sharePostToUsers(postId: string, userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      const convId = await this.startConversation(userId);
      await this.sendMessage(convId, { sharedPostId: postId });
    }
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
    // Reports are NOT deleted with the post — mirrors ON DELETE SET NULL in
    // schema.sql. Deleting a reported post must not erase the moderation
    // record; the snapshot on the report preserves what was reported.
    db.reports = db.reports.map((r) => (r.post_id === postId ? { ...r, post_id: null } : r));
    await this.save();
  }

  async toggleReaction(postId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const idx = db.reactions.findIndex((r) => r.post_id === postId && r.user_id === me.id);
    if (idx >= 0) db.reactions.splice(idx, 1);
    else db.reactions.push({ post_id: postId, user_id: me.id });
    await this.save();
  }

  async getComments(postId: string): Promise<Comment[]> {
    const db = await this.load();
    const me = await this.me();
    // Older saved demo databases predate comment likes.
    const likes = db.commentReactions ?? [];
    return db.comments
      .filter((c) => c.post_id === postId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({
        ...c,
        user: db.users.find((u) => u.id === c.user_id),
        like_count: likes.filter((r) => r.comment_id === c.id).length,
        liked_by_me: likes.some((r) => r.comment_id === c.id && r.user_id === me.id),
      }));
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

  async addComment(postId: string, text: string): Promise<Comment> {
    const db = await this.load();
    const me = await this.me();
    const comment: Comment = {
      id: uid('c-'),
      post_id: postId,
      user_id: me.id,
      text: text.trim(),
      created_at: new Date().toISOString(),
    };
    db.comments.push(comment);
    await this.save();
    return { ...comment, user: me };
  }

  async toggleRepost(postId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    const idx = db.reposts.findIndex((r) => r.post_id === postId && r.user_id === me.id);
    if (idx >= 0) db.reposts.splice(idx, 1);
    else db.reposts.push({ post_id: postId, user_id: me.id });
    await this.save();
  }

  async recordShare(postId: string): Promise<void> {
    const db = await this.load();
    const me = await this.me();
    // one share record per user per post keeps the count honest and idempotent
    if (!db.shares.some((s) => s.post_id === postId && s.user_id === me.id)) {
      db.shares.push({ post_id: postId, user_id: me.id });
      await this.save();
    }
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
