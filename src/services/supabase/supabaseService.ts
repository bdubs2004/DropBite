import {
  Comment,
  Conversation,
  DiscoverPerson,
  Message,
  LeaderboardEntry,
  LeaderboardScope,
  NewPostInput,
  NotificationPrefs,
  Post,
  ReportReason,
  Streak,
  User,
} from '../../types';
import { clamp, clampOrNull, LIMITS } from '../../lib/limits';
import { sanitizeSearchTerm } from '../../lib/searchTerm';
import { daysBetween, localDateString } from '../../lib/time';
import { DataService } from '../types';
import { getSupabase } from './client';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Kept as 'nibl.*' through the NiblGo rename: renaming would silently reset
// everyone's saved notification preferences.
const PREFS_KEY = 'nibl.notification.prefs';

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
      handle: input.handle
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, LIMITS.handle),
      display_name: clamp(input.display_name, LIMITS.displayName),
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
    // Build the update explicitly so only these fields can ever be written.
    const safe: Record<string, unknown> = {};
    if (patch.display_name !== undefined) {
      safe.display_name = clamp(patch.display_name, LIMITS.displayName);
    }
    if (patch.bio !== undefined) safe.bio = clampOrNull(patch.bio, LIMITS.bio);
    if (patch.avatar_emoji !== undefined) safe.avatar_emoji = clampOrNull(patch.avatar_emoji, 8);
    if (patch.avatar_url !== undefined) safe.avatar_url = patch.avatar_url ?? null;
    if (patch.follows_private !== undefined) {
      safe.follows_private = Boolean(patch.follows_private);
    }

    const { data, error } = await this.sb
      .from('users')
      .update(safe)
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
    const term = sanitizeSearchTerm(query ?? '');
    if (term) {
      q = q.or(`handle.ilike.%${term}%,display_name.ilike.%${term}%`);
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
    // Via a SECURITY DEFINER function so counts stay accurate for users with a
    // private follower list, whose follow rows RLS hides from us.
    const { data, error } = await this.sb.rpc('follow_counts', { target: userId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { followers: Number(row?.followers ?? 0), following: Number(row?.following ?? 0) };
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

  async searchPosts(query: string): Promise<Post[]> {
    const meId = await this.myId();
    const term = sanitizeSearchTerm(query);
    if (!term) return [];

    // Two queries rather than one: PostgREST can't OR across a joined table,
    // so match blurbs directly and recipe titles/ingredients via recipes.
    const [byBlurb, byRecipe] = await Promise.all([
      this.sb
        .from('posts')
        .select(this.POST_SELECT)
        .ilike('blurb', `%${term}%`)
        .order('created_at', { ascending: false })
        .limit(60),
      this.sb
        .from('recipes')
        .select('post_id')
        .or(`title.ilike.%${term}%,ingredients.cs.[{"item":"${term}"}]`)
        .limit(60),
    ]);

    const rows = new Map<string, any>();
    for (const r of (byBlurb.data ?? []) as any[]) rows.set(r.id, r);

    const recipePostIds = ((byRecipe.data ?? []) as any[])
      .map((r) => r.post_id)
      .filter((id) => !rows.has(id));
    if (recipePostIds.length > 0) {
      const { data: extra } = await this.sb
        .from('posts')
        .select(this.POST_SELECT)
        .in('id', recipePostIds);
      for (const r of (extra ?? []) as any[]) rows.set(r.id, r);
    }

    return [...rows.values()]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((row) => this.hydrateRow(row, meId));
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
        blurb: clamp(input.blurb, LIMITS.blurb),
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

  // ------------------------------------------------------ direct messages

  private hydrateMessageRow(row: any): Message {
    return {
      ...(row as Message),
      sender: row.users as User,
      shared_post: row.posts ? (row.posts as Post) : null,
    };
  }

  async getConversations(): Promise<Conversation[]> {
    const meId = await this.myId();
    // My memberships carry last_read_at, which drives the unread count.
    const { data: memberships, error } = await this.sb
      .from('conversation_members')
      .select('conversation_id, last_read_at, conversations(id, updated_at)')
      .eq('user_id', meId);
    if (error) throw error;

    const rows = (memberships ?? []) as any[];
    const ids = rows.map((r) => r.conversation_id);
    if (ids.length === 0) return [];

    // Two more queries regardless of thread count: the other members, and all
    // messages in my threads. RLS already limits both to threads I'm in.
    const [{ data: others }, { data: msgs }] = await Promise.all([
      this.sb
        .from('conversation_members')
        .select('conversation_id, users(*)')
        .in('conversation_id', ids)
        .neq('user_id', meId),
      this.sb
        .from('messages')
        .select('*, users(*), posts(*)')
        .in('conversation_id', ids)
        .order('created_at', { ascending: true }),
    ]);

    const otherByConv = new Map<string, User>();
    for (const o of (others ?? []) as any[]) {
      if (o.users) otherByConv.set(o.conversation_id, o.users as User);
    }
    const msgsByConv = new Map<string, any[]>();
    for (const m of (msgs ?? []) as any[]) {
      const list = msgsByConv.get(m.conversation_id) ?? [];
      list.push(m);
      msgsByConv.set(m.conversation_id, list);
    }

    return rows
      .map((r) => {
        const other = otherByConv.get(r.conversation_id);
        if (!other) return null; // other party deleted their account
        const list = msgsByConv.get(r.conversation_id) ?? [];
        const last = list.length ? list[list.length - 1] : null;
        return {
          id: r.conversation_id,
          other,
          last_message: last ? this.hydrateMessageRow(last) : null,
          unread_count: list.filter(
            (m) => m.sender_id !== meId && m.created_at > r.last_read_at,
          ).length,
          updated_at: r.conversations?.updated_at ?? new Date(0).toISOString(),
        } as Conversation;
      })
      .filter((c): c is Conversation => c !== null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    // No membership check needed here: RLS returns nothing for threads I am
    // not in, which is the same answer and can't be bypassed by a patched app.
    const { data, error } = await this.sb
      .from('messages')
      .select('*, users(*), posts(*)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any) => this.hydrateMessageRow(row));
  }

  async sendMessage(
    conversationId: string,
    input: { text?: string; sharedPostId?: string },
  ): Promise<Message> {
    const meId = await this.myId();
    const text = (input.text ?? '').trim().slice(0, 2000);
    if (!text && !input.sharedPostId) throw new Error('Nothing to send.');

    const { data, error } = await this.sb
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: meId,
        text,
        shared_post_id: input.sharedPostId ?? null,
      })
      .select('*, users(*), posts(*)')
      .single();
    if (error) throw error;

    // Keeps the inbox ordered by recency without joining messages.
    await this.sb
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    return this.hydrateMessageRow(data);
  }

  async startConversation(userId: string): Promise<string> {
    const meId = await this.myId();
    if (userId === meId) throw new Error('You cannot message yourself.');

    // Reuse an existing 1:1 rather than stacking duplicate threads. RLS scopes
    // the first query to my own memberships already.
    const { data: mine } = await this.sb
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', meId);
    const myIds = (mine ?? []).map((r: any) => r.conversation_id);
    if (myIds.length > 0) {
      const { data: shared } = await this.sb
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', userId)
        .in('conversation_id', myIds)
        .limit(1);
      if (shared && shared.length > 0) return shared[0].conversation_id as string;
    }

    const { data: conv, error: cErr } = await this.sb
      .from('conversations')
      .insert({})
      .select('id')
      .single();
    if (cErr) throw cErr;
    const convId = (conv as any).id as string;

    // Order matters: I must join the empty conversation first, because the
    // RLS policy only lets me add someone else once I am already a member.
    const { error: meErr } = await this.sb
      .from('conversation_members')
      .insert({ conversation_id: convId, user_id: meId, last_read_at: new Date().toISOString() });
    if (meErr) throw meErr;
    const { error: themErr } = await this.sb
      .from('conversation_members')
      .insert({ conversation_id: convId, user_id: userId });
    if (themErr) throw themErr;

    return convId;
  }

  async sharePostToUsers(postId: string, userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      const convId = await this.startConversation(userId);
      await this.sendMessage(convId, { sharedPostId: postId });
    }
  }

  async markConversationRead(conversationId: string): Promise<void> {
    const meId = await this.myId();
    await this.sb
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .match({ conversation_id: conversationId, user_id: meId });
  }

  async getUnreadCount(): Promise<number> {
    const convs = await this.getConversations();
    return convs.reduce((sum, c) => sum + c.unread_count, 0);
  }

  // ------------------------------------------------------------- blocking
  //
  // Reads need no client-side filtering: RLS hides blocked users' posts and
  // comments in both directions, so a patched app gains nothing.

  async blockUser(userId: string): Promise<void> {
    const meId = await this.myId();
    if (userId === meId) throw new Error('You cannot block yourself.');
    const { error } = await this.sb
      .from('blocks')
      .upsert({ blocker_id: meId, blocked_id: userId });
    if (error) throw error;
    // Sever the follow both ways. The RLS policy stops new follows; these are
    // the existing rows.
    await this.sb.from('follows').delete().match({ follower_id: meId, followee_id: userId });
    await this.sb.from('follows').delete().match({ follower_id: userId, followee_id: meId });
  }

  async unblockUser(userId: string): Promise<void> {
    const meId = await this.myId();
    const { error } = await this.sb
      .from('blocks')
      .delete()
      .match({ blocker_id: meId, blocked_id: userId });
    if (error) throw error;
  }

  async getBlockedUsers(): Promise<User[]> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('blocks')
      .select('users!blocks_blocked_id_fkey(*)')
      .eq('blocker_id', meId);
    return (data ?? []).map((r: any) => r.users as User).filter(Boolean);
  }

  async isBlocked(userId: string): Promise<boolean> {
    const meId = await this.myId();
    // Only my own blocks are readable; the other direction is invisible by
    // design, and its effects are already enforced by RLS.
    const { data } = await this.sb
      .from('blocks')
      .select('blocked_id')
      .match({ blocker_id: meId, blocked_id: userId })
      .maybeSingle();
    return Boolean(data);
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
      .insert({ post_id: postId, user_id: meId, text: clamp(text, LIMITS.comment) })
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

  async getLikedPosts(): Promise<Post[]> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('reactions')
      .select('created_at, posts(' + this.POST_SELECT + ')')
      .eq('user_id', meId)
      .order('created_at', { ascending: false });
    return (data ?? [])
      .map((r: any) => r.posts)
      .filter(Boolean)
      .map((row: any) => this.hydrateRow(row, meId));
  }

  async getCommentedPosts(): Promise<Post[]> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('comments')
      .select('post_id, created_at, posts(' + this.POST_SELECT + ')')
      .eq('user_id', meId)
      .order('created_at', { ascending: false });
    // One row per post even if I commented on it several times.
    const seen = new Set<string>();
    const out: Post[] = [];
    for (const row of (data ?? []) as any[]) {
      if (!row.posts || seen.has(row.post_id)) continue;
      seen.add(row.post_id);
      out.push(this.hydrateRow(row.posts, meId));
    }
    return out;
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

  async getLeaderboard(scope: LeaderboardScope): Promise<LeaderboardEntry[]> {
    const meId = await this.myId();
    const today = localDateString();

    let ids: string[] | null = null;
    if (scope === 'friends') {
      // You're always on your own friends board.
      ids = [...(await this.getFollowingIds()), meId];
    }

    let q = this.sb.from('streaks').select('*, users(*)');
    if (ids) q = q.in('user_id', ids);
    const { data, error } = await q.limit(200);
    if (error) throw error;

    return rankEntries(
      (data ?? [])
        .filter((row: any) => row.users)
        .map((row: any) => {
          // Same lapse rule as getStreak, so the board can't show a stale
          // streak someone stopped keeping.
          const lapsed =
            !row.last_post_date || daysBetween(row.last_post_date, today) > 1;
          return {
            user: row.users as User,
            current_streak: lapsed ? 0 : (row.current_streak as number) ?? 0,
            longest_streak: (row.longest_streak as number) ?? 0,
            is_me: row.user_id === meId,
          };
        }),
    );
  }

  async getNotificationPrefs(): Promise<NotificationPrefs> {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : { breakfast: true, lunch: true, dinner: true };
  }

  async setNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }
}
