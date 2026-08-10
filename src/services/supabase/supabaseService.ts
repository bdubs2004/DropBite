import {
  Comment,
  DiscoverPerson,
  NewPostInput,
  NotificationPrefs,
  Post,
  ReportReason,
  Streak,
  User,
} from '../../types';
import { daysBetween, localDateString } from '../../lib/time';
import { DataService } from '../types';
import { getSupabase } from './client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFS_KEY = 'nibl.notification.prefs';

/**
 * Recover the storage object path from a photo's public URL.
 *
 * Public URLs look like
 * `https://<ref>.supabase.co/storage/v1/object/public/photos/<uid>/<ts>.jpg`
 * and `storage.remove()` wants the part after the bucket name. Returns null
 * for anything that isn't one of our own bucket URLs, so we never try to
 * delete a path we didn't create.
 */
function storagePathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = '/storage/v1/object/public/photos/';
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const path = url.slice(at + marker.length).split('?')[0];
  return path.length > 0 ? decodeURIComponent(path) : null;
}

/**
 * Production backend. Requires the schema in supabase/schema.sql and the
 * storage bucket "photos". See SETUP_GUIDE.md for the full wiring steps.
 */
export class SupabaseService implements DataService {
  private get sb() {
    return getSupabase();
  }

  private async myId(): Promise<string> {
    const { data, error } = await this.sb.auth.getUser();
    if (error || !data.user) throw new Error('Not signed in');
    return data.user.id;
  }

  async getCurrentUser(): Promise<User | null> {
    const { data } = await this.sb.auth.getUser();
    if (!data.user) return null;
    const { data: profile } = await this.sb
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();
    return (profile as User) ?? null;
  }

  async signUp(input: {
    email: string;
    password: string;
    handle: string;
    display_name: string;
    avatar_emoji?: string;
  }): Promise<User> {
    const { data, error } = await this.sb.auth.signUp({
      email: input.email,
      password: input.password,
    });
    if (error) throw error;
    if (!data.user) throw new Error('Sign-up failed');
    const profile: Partial<User> = {
      id: data.user.id,
      handle: input.handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''),
      display_name: input.display_name.trim(),
      avatar_emoji: input.avatar_emoji ?? null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    };
    const { data: created, error: pErr } = await this.sb
      .from('users')
      .insert(profile)
      .select()
      .single();
    if (pErr) throw pErr;
    return created as User;
  }

  async signIn(email: string, password: string): Promise<User> {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const me = await this.getCurrentUser();
    if (!me) throw new Error('Profile missing');
    return me;
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  async deleteAccount(): Promise<void> {
    // Deleting an auth user requires a service-role key, so this calls the
    // delete-account edge function (see supabase/functions/delete-account).
    const { error } = await this.sb.functions.invoke('delete-account');
    if (error) throw error;
    await this.sb.auth.signOut();
  }

  async exportMyData(): Promise<string> {
    const meId = await this.myId();
    const [profile, posts, follows, reactions, streak] = await Promise.all([
      this.sb.from('users').select('*').eq('id', meId).single(),
      this.sb.from('posts').select('*, recipes(*)').eq('user_id', meId),
      this.sb.from('follows').select('*').eq('follower_id', meId),
      this.sb.from('reactions').select('*').eq('user_id', meId),
      this.sb.from('streaks').select('*').eq('user_id', meId).maybeSingle(),
    ]);
    return JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        profile: profile.data,
        posts: posts.data,
        follows: follows.data,
        reactions: reactions.data,
        streak: streak.data,
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
    const meId = await this.myId();
    const { data, error } = await this.sb
      .from('users')
      .update(patch)
      .eq('id', meId)
      .select()
      .single();
    if (error) throw error;
    return data as User;
  }

  async setAvatar(localUri: string): Promise<User> {
    const meId = await this.myId();
    // Same bucket and per-user folder as post photos, so the existing storage
    // policy ("write only under your own uid") already covers it.
    const resp = await fetch(localUri);
    const bytes = await resp.arrayBuffer();
    const path = `${meId}/avatar-${Date.now()}.jpg`;
    const { error } = await this.sb.storage
      .from('photos')
      .upload(path, bytes, { contentType: 'image/jpeg' });
    if (error) throw error;
    const url = this.sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
    // Clearing avatar_emoji keeps one source of truth for what to render.
    return this.updateProfile({ avatar_url: url, avatar_emoji: null });
  }

  async listUsers(query?: string): Promise<User[]> {
    const meId = await this.myId();
    let q = this.sb.from('users').select('*').neq('id', meId).limit(50);
    if (query?.trim()) {
      const like = `%${query.trim()}%`;
      q = q.or(`handle.ilike.${like},display_name.ilike.${like}`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as User[];
  }

  async getFollowingIds(): Promise<string[]> {
    const meId = await this.myId();
    const { data } = await this.sb.from('follows').select('followee_id').eq('follower_id', meId);
    return (data ?? []).map((r: { followee_id: string }) => r.followee_id);
  }

  async follow(userId: string): Promise<void> {
    const meId = await this.myId();
    await this.sb.from('follows').upsert({ follower_id: meId, followee_id: userId });
  }

  async unfollow(userId: string): Promise<void> {
    const meId = await this.myId();
    await this.sb.from('follows').delete().match({ follower_id: meId, followee_id: userId });
  }

  async getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
    const [followers, following] = await Promise.all([
      this.sb.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', userId),
      this.sb.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
    ]);
    return { followers: followers.count ?? 0, following: following.count ?? 0 };
  }

  async getFollowers(userId: string): Promise<User[]> {
    const { data } = await this.sb
      .from('follows')
      .select('users!follows_follower_id_fkey(*)')
      .eq('followee_id', userId);
    return (data ?? []).map((r: any) => r.users as User).filter(Boolean);
  }

  async getFollowingUsers(userId: string): Promise<User[]> {
    const { data } = await this.sb
      .from('follows')
      .select('users!follows_followee_id_fkey(*)')
      .eq('follower_id', userId);
    return (data ?? []).map((r: any) => r.users as User).filter(Boolean);
  }

  private hydrateRow(row: any, meId: string): Post {
    return {
      ...(row as Post),
      user: row.users as User,
      recipe: Array.isArray(row.recipes) ? row.recipes[0] ?? null : row.recipes ?? null,
      reaction_count: (row.reactions ?? []).length,
      reacted_by_me: (row.reactions ?? []).some((r: any) => r.user_id === meId),
      comment_count: (row.comments ?? []).length,
      share_count: (row.shares ?? []).length,
      repost_count: (row.reposts ?? []).length,
      reposted_by_me: (row.reposts ?? []).some((r: any) => r.user_id === meId),
      saved_by_me: (row.saved_posts ?? []).some((r: any) => r.user_id === meId),
    };
  }

  private readonly POST_SELECT =
    '*, users(*), recipes(*), reactions(user_id), comments(id), shares(user_id), reposts(user_id), saved_posts(user_id)';

  async getFeed(): Promise<Post[]> {
    const meId = await this.myId();
    const ids = [...(await this.getFollowingIds()), meId];
    const { data, error } = await this.sb
      .from('posts')
      .select(this.POST_SELECT)
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []).map((row: any) => this.hydrateRow(row, meId));
  }

  async getPost(postId: string): Promise<Post | null> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('posts')
      .select(this.POST_SELECT)
      .eq('id', postId)
      .maybeSingle();
    return data ? this.hydrateRow(data as any, meId) : null;
  }

  async getDiscoverPosts(): Promise<Post[]> {
    const meId = await this.myId();
    // Everyone's posts, not just your feed. Your own are excluded.
    const { data, error } = await this.sb
      .from('posts')
      .select(this.POST_SELECT)
      .neq('user_id', meId)
      .order('created_at', { ascending: false })
      .limit(120);
    if (error) throw error;
    return (data ?? []).map((row: any) => this.hydrateRow(row, meId));
  }

  async getDiscoverPeople(): Promise<DiscoverPerson[]> {
    const meId = await this.myId();
    const [{ data: users }, followingIds] = await Promise.all([
      this.sb.from('users').select('*').neq('id', meId).limit(30),
      this.getFollowingIds(),
    ]);
    const people = (users ?? []) as User[];
    if (people.length === 0) return [];

    // One query for everyone's posts rather than one per person, then group
    // in memory — 2 round trips total regardless of how many people we show.
    const { data: posts } = await this.sb
      .from('posts')
      .select(this.POST_SELECT)
      .in(
        'user_id',
        people.map((u) => u.id),
      )
      .order('created_at', { ascending: false })
      .limit(300);

    const byUser = new Map<string, Post[]>();
    for (const row of (posts ?? []) as any[]) {
      const list = byUser.get(row.user_id) ?? [];
      list.push(this.hydrateRow(row, meId));
      byUser.set(row.user_id, list);
    }
    const following = new Set(followingIds);
    return people
      .map((u) => {
        const mine = byUser.get(u.id) ?? [];
        return {
          user: u,
          posts: mine.slice(0, 3),
          post_count: mine.length,
          is_following: following.has(u.id),
        };
      })
      .sort((a, b) =>
        a.is_following === b.is_following
          ? b.post_count - a.post_count
          : Number(a.is_following) - Number(b.is_following),
      );
  }

  async getUserPosts(userId: string): Promise<Post[]> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('posts')
      .select(this.POST_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return (data ?? []).map((row: any) => this.hydrateRow(row, meId));
  }

  /** Upload a local photo URI to the "photos" bucket, return its public URL. */
  private async uploadPhoto(localUri: string, meId: string): Promise<string> {
    const resp = await fetch(localUri);
    const blob = await resp.arrayBuffer();
    const path = `${meId}/${Date.now()}.jpg`;
    const { error } = await this.sb.storage.from('photos').upload(path, blob, {
      contentType: 'image/jpeg',
    });
    if (error) throw error;
    return this.sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
  }

  async createPost(input: NewPostInput): Promise<Post> {
    const meId = await this.myId();
    let photoUrl = input.photo_url;
    if (photoUrl && !photoUrl.startsWith('http')) {
      photoUrl = await this.uploadPhoto(photoUrl, meId);
    }
    const { data, error } = await this.sb
      .from('posts')
      .insert({
        user_id: meId,
        meal_slot: input.meal_slot,
        photo_url: photoUrl,
        blurb: input.blurb,
        restaurant_place_id: input.restaurant?.place_id ?? null,
        restaurant_name: input.restaurant?.name ?? null,
        lat: input.restaurant?.lat ?? null,
        lng: input.restaurant?.lng ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    const post = data as Post;
    if (input.recipe) {
      await this.sb.from('recipes').insert({
        post_id: post.id,
        title: input.recipe.title,
        ingredients: input.recipe.ingredients,
        steps: input.recipe.steps,
        cook_time_minutes: input.recipe.cook_time_minutes,
        ai_generated: input.recipe.ai_generated,
        user_edited: input.recipe.user_edited,
      });
    }
    // streak upsert
    const today = localDateString();
    const { data: s } = await this.sb.from('streaks').select('*').eq('user_id', meId).maybeSingle();
    const prev = s as Streak | null;
    let current = 1;
    if (prev?.last_post_date) {
      const gap = daysBetween(prev.last_post_date, today);
      if (gap === 0) current = prev.current_streak;
      else if (gap === 1) current = prev.current_streak + 1;
    }
    await this.sb.from('streaks').upsert({
      user_id: meId,
      current_streak: current,
      longest_streak: Math.max(prev?.longest_streak ?? 0, current),
      last_post_date: today,
    });
    return post;
  }

  async reportPost(postId: string, reason: ReportReason, detail?: string): Promise<void> {
    const meId = await this.myId();

    // Snapshot the post now. The report outlives the post (post_id is
    // ON DELETE SET NULL), so without this a reviewer would see an empty row
    // after the author deletes the content.
    const { data: post } = await this.sb
      .from('posts')
      .select('user_id, blurb, photo_url')
      .eq('id', postId)
      .maybeSingle();
    if (!post) throw new Error('That post no longer exists.');

    const target = post as { user_id: string; blurb: string | null; photo_url: string | null };
    if (target.user_id === meId) throw new Error('You cannot report your own post.');

    const { error } = await this.sb.from('reports').insert({
      post_id: postId,
      reporter_id: meId,
      reported_user_id: target.user_id,
      reason,
      detail: detail?.trim() ? detail.trim().slice(0, 1000) : null,
      post_blurb_snapshot: target.blurb,
      post_photo_url_snapshot: target.photo_url,
    });

    // 23505 = unique violation on (reporter_id, post_id): they already
    // reported this. Treat as success so the UI doesn't show a scary error.
    if (error && (error as { code?: string }).code !== '23505') throw error;
  }

  async deletePost(postId: string): Promise<void> {
    const meId = await this.myId();

    // Read the photo path first: once the row is gone we can't recover it, and
    // leaving the file behind would keep a public URL alive for a deleted post.
    const { data: existing } = await this.sb
      .from('posts')
      .select('photo_url')
      .eq('id', postId)
      .eq('user_id', meId)
      .maybeSingle();

    // Child rows (recipes, reactions, comments, reposts, shares, saved_posts)
    // are removed by ON DELETE CASCADE in schema.sql. The user_id filter plus
    // the "delete own posts" RLS policy both scope this to the author.
    const { error } = await this.sb.from('posts').delete().eq('id', postId).eq('user_id', meId);
    if (error) throw error;

    const path = storagePathFromPublicUrl((existing as { photo_url?: string } | null)?.photo_url);
    if (path) {
      // Best-effort: the post is already gone, so a failed cleanup shouldn't
      // surface as a failed delete. Worst case it's an orphaned file.
      await this.sb.storage.from('photos').remove([path]);
    }
  }

  async toggleReaction(postId: string): Promise<void> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('reactions')
      .select('*')
      .match({ post_id: postId, user_id: meId })
      .maybeSingle();
    if (data) {
      await this.sb.from('reactions').delete().match({ post_id: postId, user_id: meId });
    } else {
      await this.sb.from('reactions').insert({ post_id: postId, user_id: meId, type: 'like' });
    }
  }

  async getComments(postId: string): Promise<Comment[]> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('comments')
      .select('*, users(*), comment_reactions(user_id)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    return (data ?? []).map((row: any) => ({
      ...(row as Comment),
      user: row.users as User,
      like_count: (row.comment_reactions ?? []).length,
      liked_by_me: (row.comment_reactions ?? []).some((r: any) => r.user_id === meId),
    }));
  }

  async toggleCommentLike(commentId: string): Promise<void> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('comment_reactions')
      .select('comment_id')
      .match({ comment_id: commentId, user_id: meId })
      .maybeSingle();
    if (data) {
      await this.sb
        .from('comment_reactions')
        .delete()
        .match({ comment_id: commentId, user_id: meId });
    } else {
      await this.sb.from('comment_reactions').insert({ comment_id: commentId, user_id: meId });
    }
  }

  async addComment(postId: string, text: string): Promise<Comment> {
    const meId = await this.myId();
    const { data, error } = await this.sb
      .from('comments')
      .insert({ post_id: postId, user_id: meId, text: text.trim() })
      .select('*, users(*)')
      .single();
    if (error) throw error;
    return { ...(data as Comment), user: (data as any).users as User };
  }

  async toggleRepost(postId: string): Promise<void> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('reposts')
      .select('*')
      .match({ post_id: postId, user_id: meId })
      .maybeSingle();
    if (data) {
      await this.sb.from('reposts').delete().match({ post_id: postId, user_id: meId });
    } else {
      await this.sb.from('reposts').insert({ post_id: postId, user_id: meId });
    }
  }

  async recordShare(postId: string): Promise<void> {
    const meId = await this.myId();
    // upsert keeps one share row per user per post (idempotent count)
    await this.sb.from('shares').upsert({ post_id: postId, user_id: meId });
  }

  async toggleSave(postId: string): Promise<void> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('saved_posts')
      .select('*')
      .match({ post_id: postId, user_id: meId })
      .maybeSingle();
    if (data) {
      await this.sb.from('saved_posts').delete().match({ post_id: postId, user_id: meId });
    } else {
      await this.sb.from('saved_posts').insert({ post_id: postId, user_id: meId });
    }
  }

  async getSavedPosts(): Promise<Post[]> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('saved_posts')
      .select('created_at, posts(' + this.POST_SELECT + ')')
      .eq('user_id', meId)
      .order('created_at', { ascending: false });
    return (data ?? [])
      .map((r: any) => r.posts)
      .filter(Boolean)
      .map((row: any) => this.hydrateRow(row, meId));
  }

  async getStreak(userId: string): Promise<Streak> {
    const { data } = await this.sb.from('streaks').select('*').eq('user_id', userId).maybeSingle();
    const s = (data as Streak) ?? {
      user_id: userId,
      current_streak: 0,
      longest_streak: 0,
      last_post_date: null,
    };
    if (s.last_post_date && daysBetween(s.last_post_date, localDateString()) > 1) {
      s.current_streak = 0;
    }
    return s;
  }

  async getNotificationPrefs(): Promise<NotificationPrefs> {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : { breakfast: true, lunch: true, dinner: true };
  }

  async setNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }
}
