import AsyncStorage from '@react-native-async-storage/async-storage';
import { uid } from '../../lib/id';
import { daysBetween, localDateString } from '../../lib/time';
import {
  Comment,
  NewPostInput,
  NotificationPrefs,
  Post,
  Recipe,
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

interface Db {
  users: User[];
  posts: Post[];
  recipes: Recipe[];
  follows: { follower_id: string; followee_id: string }[];
  reactions: { post_id: string; user_id: string }[];
  comments: Comment[];
  reposts: { post_id: string; user_id: string }[];
  shares: { post_id: string; user_id: string }[];
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
    patch: Partial<Pick<User, 'display_name' | 'bio' | 'avatar_emoji' | 'follows_private'>>,
  ): Promise<User> {
    const db = await this.load();
    const me = await this.me();
    Object.assign(me, patch);
    await this.save();
    return me;
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
    return db.comments
      .filter((c) => c.post_id === postId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({ ...c, user: db.users.find((u) => u.id === c.user_id) }));
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
