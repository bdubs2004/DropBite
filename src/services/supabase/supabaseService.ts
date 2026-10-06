import {
  AppNotification,
  Collection,
  Comment,
  SignUpResult,
  FeedbackKind,
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
import { EMAIL_CONFIRM_URL, PASSWORD_RESET_URL } from '../../config';
import { appVersion, platformName } from '../../lib/appInfo';
import { cleanHandle } from '../../lib/handle';
import { clamp, clampOrNull, LIMITS } from '../../lib/limits';
import { collectionNameProblem, tidyCollectionName } from '../../lib/collectionName';
import { sanitizeSearchTerm } from '../../lib/searchTerm';
import { daysBetween, localDateString } from '../../lib/time';
import { DataService } from '../types';
import { getSupabase } from './client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';

// Decode base64 to raw bytes without relying on atob (not guaranteed on all
// React Native engines). Used for photo upload — see uploadPhoto.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(base64: string): Uint8Array {
  const lookup = new Uint8Array(256);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const n = clean.length;
  const bytes = new Uint8Array((n * 3) >> 2);
  let p = 0;
  for (let i = 0; i < n; i += 4) {
    const c0 = lookup[clean.charCodeAt(i)];
    const c1 = lookup[clean.charCodeAt(i + 1)];
    const c2 = lookup[clean.charCodeAt(i + 2)];
    const c3 = lookup[clean.charCodeAt(i + 3)];
    if (p < bytes.length) bytes[p++] = (c0 << 2) | (c1 >> 4);
    if (p < bytes.length) bytes[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (p < bytes.length) bytes[p++] = ((c2 & 3) << 6) | c3;
  }
  return bytes;
}

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
    await this.loadCaps();
    return data.user.id;
  }

  /**
   * Which newer tables/columns this database has, checked once per launch.
   *
   * Queries only ask for post tags, shared profiles and message reactions
   * when they exist. Asking PostgREST for a relationship that isn't there
   * fails the WHOLE query, so a database that hasn't run migration 0023/0024
   * yet would otherwise lose its feed and chats instead of just the new bits.
   * `leave` is migration 0025 (leaving groups, and the is_group flag);
   * `photoSize` is 0026 (photo width/height on posts).
   */
  private caps = {
    tags: false,
    profileShares: false,
    reactions: false,
    leave: false,
    photoSize: false,
  };
  private capsLoaded: Promise<void> | null = null;
  private loadCaps(): Promise<void> {
    if (!this.capsLoaded) {
      this.capsLoaded = (async () => {
        const [tags, shares, reactions, leave, photoSize] = await Promise.all([
          this.sb.from('post_tags').select('post_id').limit(1),
          this.sb.from('messages').select('shared_user_id').limit(1),
          this.sb.from('message_reactions').select('message_id').limit(1),
          this.sb.from('conversations').select('is_group').limit(1),
          this.sb.from('posts').select('photo_width').limit(1),
        ]);
        // All of them failing is a network problem, not a schema answer:
        // try again on the next call rather than switching everything off.
        if (tags.error && shares.error && reactions.error && leave.error && photoSize.error) {
          this.capsLoaded = null;
          return;
        }
        this.caps = {
          tags: !tags.error,
          profileShares: !shares.error,
          reactions: !reactions.error,
          leave: !leave.error,
          photoSize: !photoSize.error,
        };
      })().catch(() => {
        this.capsLoaded = null;
      });
    }
    return this.capsLoaded ?? Promise.resolve();
  }

  /** Everything a chat message is shown with. */
  private get MESSAGE_SELECT(): string {
    return (
      '*, users!messages_sender_id_fkey(*), posts!messages_shared_post_id_fkey(*, users!posts_user_id_fkey(*))' +
      (this.caps.profileShares ? ', shared_user:users!messages_shared_user_id_fkey(*)' : '') +
      (this.caps.reactions ? ', message_reactions(user_id, emoji)' : '')
    );
  }

  async getCurrentUser(): Promise<User | null> {
    const { data } = await this.sb.auth.getUser();
    if (!data.user) return null;
    // ensureProfile rather than a plain select: a session restored after the
    // user confirmed their email may still have no profile row.
    return this.ensureProfile();
  }

  async signUp(input: {
    email: string;
    password: string;
    handle: string;
    display_name: string;
    avatar_emoji?: string;
  }): Promise<SignUpResult> {
    // Capitals are kept as typed (see lib/handle).
    const handle = cleanHandle(input.handle);
    const display_name = clamp(input.display_name, LIMITS.displayName);

    // Carry the profile fields in the auth user's metadata. With email
    // confirmation on there is no session yet, so the profile row cannot be
    // written here — and the user may well click the link on another device,
    // where nothing we stored locally would be available. Metadata travels with
    // the account, so ensureProfile() can finish the job wherever they land.
    const { data, error } = await this.sb.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        // Land the confirmation link on our own page, which finishes the
        // verification and offers a way back into the app — not the Site URL.
        emailRedirectTo: EMAIL_CONFIRM_URL,
        data: {
          handle,
          display_name,
          avatar_emoji: input.avatar_emoji ?? null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        },
      },
    });
    if (error) throw error;
    if (!data.user) throw new Error('Sign-up failed');

    // No session means the project requires email confirmation. Not an error —
    // unless the email is already taken: Supabase returns a fake success with
    // an empty `identities` array and sends nothing, to avoid revealing which
    // emails are registered. Catch that so we don't promise an email that will
    // never arrive.
    if (!data.session) {
      const identities = (data.user as { identities?: unknown[] }).identities;
      if (Array.isArray(identities) && identities.length === 0) {
        return { status: 'already_exists', email: input.email };
      }
      return { status: 'confirm_email', email: input.email };
    }

    const user = await this.ensureProfile();
    if (!user) throw new Error('Profile could not be created');
    return { status: 'ready', user };
  }

  /**
   * Make sure the signed-in user has a profile row, creating it from the auth
   * metadata if not.
   *
   * Called after every sign-in because the row may not exist yet: with email
   * confirmation enabled, sign-up cannot write it. Idempotent — if the row is
   * already there it is simply returned.
   */
  private async ensureProfile(): Promise<User | null> {
    const { data: auth } = await this.sb.auth.getUser();
    if (!auth.user) return null;

    const { data: existing } = await this.sb
      .from('users')
      .select('*')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (existing) return existing as User;

    const meta = (auth.user.user_metadata ?? {}) as Record<string, unknown>;
    const rawHandle = typeof meta.handle === 'string' ? meta.handle : '';
    // A handle is required and must be unique. If metadata is missing — an
    // account made outside this app, say — derive one rather than fail, and
    // add a suffix so a collision doesn't lock the account out entirely.
    let base =
      cleanHandle(rawHandle) ||
      (auth.user.email ?? 'user').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) ||
      'user';

    for (let attempt = 0; attempt < 6; attempt++) {
      const handle = attempt === 0 ? base : `${base.slice(0, 24)}${Math.floor(Math.random() * 10000)}`;
      const { data: created, error } = await this.sb
        .from('users')
        .insert({
          id: auth.user.id,
          handle,
          display_name:
            (typeof meta.display_name === 'string' && meta.display_name) || handle,
          avatar_emoji: typeof meta.avatar_emoji === 'string' ? meta.avatar_emoji : null,
          timezone:
            (typeof meta.timezone === 'string' && meta.timezone) ||
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            'UTC',
        })
        .select()
        .single();
      if (!error) return created as User;
      const code = (error as { code?: string }).code;
      // 23514 is check_violation: a database that hasn't run migration 0027
      // still only allows lowercase handles. Keep the handle, just lowercased,
      // rather than leave the account without a profile.
      if (code === '23514' && base !== base.toLowerCase()) {
        base = base.toLowerCase();
        attempt--;
        continue;
      }
      // 23505 is unique_violation: the handle is taken, try another.
      if (code !== '23505') throw error;
    }
    throw new Error('Could not pick an available handle. Please try a different one.');
  }

  async signIn(email: string, password: string): Promise<User> {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // First sign-in after confirming an email lands here with no profile row
    // yet — this is where the account is actually finished.
    const me = await this.ensureProfile();
    if (!me) throw new Error('Profile missing');
    return me;
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  async requestPasswordReset(email: string): Promise<void> {
    // redirectTo is the app's deep link: recovery must land in the app, which
    // is the only place the returned session can be used to set a new password.
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: PASSWORD_RESET_URL,
    });
    if (error) throw error;
  }

  async resendConfirmation(email: string): Promise<void> {
    const { error } = await this.sb.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: EMAIL_CONFIRM_URL },
    });
    if (error) throw error;
  }

  async setSessionFromTokens(accessToken: string, refreshToken: string): Promise<void> {
    const { error } = await this.sb.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
  }

  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
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
    const [profile, posts, follows, reactions, streak, collections] = await Promise.all([
      this.sb.from('users').select('*').eq('id', meId).single(),
      this.sb.from('posts').select('*, recipes(*)').eq('user_id', meId),
      this.sb.from('follows').select('*').eq('follower_id', meId),
      this.sb.from('reactions').select('*').eq('user_id', meId),
      this.sb.from('streaks').select('*').eq('user_id', meId).maybeSingle(),
      this.sb.from('collections').select('*, collection_posts(post_id, added_at)').eq('user_id', meId),
    ]);
    return JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        profile: profile.data,
        posts: posts.data,
        follows: follows.data,
        reactions: reactions.data,
        streak: streak.data,
        collections: collections.data,
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

  async getUser(userId: string): Promise<User | null> {
    const { data, error } = await this.sb.from('users').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return (data as User | null) ?? null;
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

  async getCommentLikers(commentId: string): Promise<User[]> {
    const { data } = await this.sb
      .from('comment_reactions')
      .select('users(*)')
      .eq('comment_id', commentId)
      .order('created_at', { ascending: false });
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
      tagged: (row.post_tags ?? []).map((t: any) => t.users as User).filter(Boolean),
    };
  }

  // users(*) is disambiguated to the direct author FK: junction tables
  // (reactions, comments, reposts, ...) give PostgREST several posts<->users
  // paths, and a bare users(*) makes it error ("more than one relationship
  // was found for 'posts' and 'users'"), which breaks the feed, Discover and
  // the refresh right after posting.
  private get POST_SELECT(): string {
    return (
      '*, users!posts_user_id_fkey(*), recipes(*), reactions(user_id), comments(id), shares(user_id), reposts(user_id), saved_posts(user_id)' +
      // post_tags has a single FK to users, so this embed is unambiguous.
      (this.caps.tags ? ', post_tags(users(*))' : '')
    );
  }

  async getFeed(): Promise<Post[]> {
    const meId = await this.myId();
    const followingIds = await this.getFollowingIds();
    const authorIds = [...followingIds, meId];

    // Two sources, merged: posts written by people you follow (and yourself),
    // and posts *reposted* by people you follow — surfaced with a "reposted"
    // label and bumped to their repost time, the way TikTok resurfaces reposts.
    const [origRes, repostRes] = await Promise.all([
      this.sb
        .from('posts')
        .select(this.POST_SELECT)
        .in('user_id', authorIds)
        .order('created_at', { ascending: false })
        .limit(100),
      followingIds.length
        ? this.sb
            .from('reposts')
            // Only one reposts->users relationship (user_id), so the bare embed
            // is unambiguous and avoids depending on the FK constraint name.
            .select('post_id, user_id, created_at, users(*)')
            .in('user_id', followingIds)
            .order('created_at', { ascending: false })
            .limit(60)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (origRes.error) throw origRes.error;

    const rowsById = new Map<string, any>();
    for (const row of (origRes.data ?? []) as any[]) rowsById.set(row.id, row);

    // Group reposts by post, keeping ALL the reposters (you follow) newest
    // first, so the card can show stacked avatars + a count. The query is
    // already newest-first, so first-seen order is newest-first.
    const repostsByPost = new Map<string, { users: User[]; latest: string }>();
    for (const r of (repostRes.data ?? []) as any[]) {
      const entry = repostsByPost.get(r.post_id) ?? { users: [] as User[], latest: r.created_at };
      if (r.users && !entry.users.some((u) => u.id === r.users.id)) {
        entry.users.push(r.users as User);
      }
      if (r.created_at > entry.latest) entry.latest = r.created_at;
      repostsByPost.set(r.post_id, entry);
    }

    // Fetch any reposted post we didn't already pull with the originals.
    const missing = [...repostsByPost.keys()].filter((id) => !rowsById.has(id));
    if (missing.length) {
      const { data: extra } = await this.sb
        .from('posts')
        .select(this.POST_SELECT)
        .in('id', missing);
      for (const row of (extra ?? []) as any[]) rowsById.set(row.id, row);
    }

    // Sort key per post id: the original's created_at, or a repost's time if a
    // followed user reposted it more recently.
    const merged = new Map<string, { post: Post; ts: string }>();
    for (const row of rowsById.values()) {
      const post = this.hydrateRow(row, meId);
      merged.set(post.id, { post, ts: post.created_at });
    }
    for (const [postId, entry] of repostsByPost) {
      const row = rowsById.get(postId);
      if (!row) continue; // deleted or not visible
      // Don't credit the author for reposting their own post.
      const reposters = entry.users.filter((u) => u.id !== row.user_id);
      if (!reposters.length) continue;
      const post = this.hydrateRow(row, meId);
      post.reposters = reposters;
      post.reposter = reposters[0];
      post.repost_at = entry.latest;
      merged.set(post.id, { post, ts: entry.latest });
    }

    return [...merged.values()]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .map((x) => x.post)
      .slice(0, 100);
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

  async getReposts(userId: string): Promise<Post[]> {
    const meId = await this.myId();
    const { data: reposts } = await this.sb
      .from('reposts')
      .select('post_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    const ids = (reposts ?? []).map((r: any) => r.post_id);
    if (!ids.length) return [];
    const { data: postsData } = await this.sb
      .from('posts')
      .select(this.POST_SELECT)
      .in('id', ids);
    const byId = new Map<string, Post>(
      (postsData ?? []).map((row: any) => [row.id, this.hydrateRow(row, meId)]),
    );
    // Keep the newest-first repost order; skip any deleted/hidden post.
    return (reposts ?? [])
      .map((r: any) => byId.get(r.post_id))
      .filter((p: Post | undefined): p is Post => Boolean(p));
  }

  /** Upload a local photo URI to the "photos" bucket, return its public URL. */
  private async uploadPhoto(localUri: string, meId: string): Promise<string> {
    const path = `${meId}/${Date.now()}.jpg`;
    const bytes = await this.readJpegBytes(localUri);
    if (bytes.length === 0) throw new Error('The selected photo could not be read.');
    const { error } = await this.sb.storage.from('photos').upload(path, bytes, {
      contentType: 'image/jpeg',
    });
    if (error) throw error;
    return this.sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
  }

  /**
   * Read a photo into raw JPEG bytes.
   *
   * `fetch(fileUri).arrayBuffer()` is unreliable on React Native — for a local
   * file:// URI it frequently returns an empty buffer, which uploaded a 0-byte
   * image (or failed). Instead read the file as base64 (a data: URL already
   * carries it; a native file goes through the image manipulator, which also
   * guarantees a JPEG) and decode that.
   */
  private async readJpegBytes(uri: string): Promise<Uint8Array> {
    if (uri.startsWith('data:')) {
      return base64ToBytes(uri.slice(uri.indexOf(',') + 1));
    }
    const out = await ImageManipulator.manipulateAsync(uri, [], {
      base64: true,
      compress: 0.9,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    if (!out.base64) throw new Error('The selected photo could not be read.');
    return base64ToBytes(out.base64);
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
        // Only on a database with migration 0026, or the insert would fail.
        ...(this.caps.photoSize && input.photo_width && input.photo_height
          ? {
              photo_width: Math.round(input.photo_width),
              photo_height: Math.round(input.photo_height),
            }
          : {}),
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
      // The post already exists; the recipe is supplementary, so a failure here
      // must never lose the post (CLAUDE.md: never block the post). A common
      // cause is a database missing migration 0012 — the servings/nutrition
      // columns — which surfaces here rather than blocking the whole post.
      const { error: recipeErr } = await this.sb.from('recipes').insert({
        post_id: post.id,
        title: input.recipe.title,
        ingredients: input.recipe.ingredients,
        steps: input.recipe.steps,
        cook_time_minutes: input.recipe.cook_time_minutes,
        ai_generated: input.recipe.ai_generated,
        user_edited: input.recipe.user_edited,
        // Totals for the whole dish; `servings` is the display divisor.
        servings: input.recipe.servings ?? 1,
        nutrition: input.recipe.nutrition ?? null,
        nutrition_source: input.recipe.nutrition_source ?? null,
      });
      if (recipeErr) {
        console.warn('recipe insert failed (post still saved):', recipeErr.message);
      }
    }
    // Tags are supplementary too: a failure must never lose the post.
    if (input.tag_user_ids?.length) {
      try {
        await this.setPostTags(post.id, input.tag_user_ids);
      } catch (e: any) {
        console.warn('tagging failed (post still saved):', e?.message);
      }
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

  async setPostTags(postId: string, userIds: string[]): Promise<void> {
    const meId = await this.myId();
    const want = [...new Set(userIds)].filter((id) => id !== meId);
    const { data: current, error } = await this.sb
      .from('post_tags')
      .select('user_id')
      .eq('post_id', postId);
    if (error) throw error;
    const had = new Set((current ?? []).map((r: any) => r.user_id as string));
    const add = want.filter((id) => !had.has(id));
    const drop = [...had].filter((id) => !want.includes(id));
    if (drop.length) {
      const { error: delErr } = await this.sb
        .from('post_tags')
        .delete()
        .eq('post_id', postId)
        .in('user_id', drop);
      if (delErr) throw delErr;
    }
    if (add.length) {
      // RLS checks it's your post, nobody is you, and nobody is blocked; the
      // trigger sends each new person their "tagged you" notification.
      const { error: addErr } = await this.sb
        .from('post_tags')
        .insert(add.map((user_id) => ({ post_id: postId, user_id })));
      if (addErr) throw addErr;
    }
  }

  // ------------------------------------------------------ direct messages

  private hydrateMessageRow(row: any): Message {
    return {
      ...(row as Message),
      sender: row.users as User,
      // Carry the shared post's author through so the DM card can show it.
      shared_post: row.posts
        ? ({ ...(row.posts as Post), user: (row.posts.users as User) ?? undefined } as Post)
        : null,
      shared_user: (row.shared_user as User) ?? null,
      reactions: row.message_reactions ?? [],
    };
  }

  async getConversations(): Promise<Conversation[]> {
    const meId = await this.myId();
    // My memberships carry last_read_at, which drives the unread count.
    const { data: memberships, error } = await this.sb
      .from('conversation_members')
      .select(
        `conversation_id, last_read_at, conversations(id, updated_at, title${this.caps.leave ? ', is_group' : ''})`,
      )
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
        .select(this.MESSAGE_SELECT)
        .in('conversation_id', ids)
        .order('created_at', { ascending: true }),
    ]);

    const othersByConv = new Map<string, User[]>();
    for (const o of (others ?? []) as any[]) {
      if (o.users) {
        const list = othersByConv.get(o.conversation_id) ?? [];
        list.push(o.users as User);
        othersByConv.set(o.conversation_id, list);
      }
    }
    const msgsByConv = new Map<string, any[]>();
    for (const m of (msgs ?? []) as any[]) {
      const list = msgsByConv.get(m.conversation_id) ?? [];
      list.push(m);
      msgsByConv.set(m.conversation_id, list);
    }

    return rows
      .map((r) => {
        // Keep the thread visible even if the other side left or deleted
        // their account, rather than silently losing the history.
        const membersOther = othersByConv.get(r.conversation_id) ?? [];
        const others: User[] =
          membersOther.length > 0
            ? membersOther
            : [
                {
                  id: `gone-${r.conversation_id}`,
                  handle: 'unavailable',
                  display_name: 'Someone',
                  avatar_url: null,
                  avatar_emoji: null,
                  bio: null,
                  timezone: 'UTC',
                  created_at: new Date(0).toISOString(),
                } as User,
              ];
        const list = msgsByConv.get(r.conversation_id) ?? [];
        const last = list.length ? list[list.length - 1] : null;
        return {
          id: r.conversation_id,
          other: others[0],
          others,
          // Remembered from when it started (migration 0025), so a group that
          // drops to two people after someone leaves is still a group.
          is_group: r.conversations?.is_group ?? others.length > 1,
          title: r.conversations?.title ?? null,
          last_message: last ? this.hydrateMessageRow(last) : null,
          // "Left the chat" lines don't count as unread.
          unread_count: list.filter(
            (m) => m.sender_id !== meId && m.kind !== 'left' && m.created_at > r.last_read_at,
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
    await this.loadCaps();
    const { data, error } = await this.sb
      .from('messages')
      .select(this.MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any) => this.hydrateMessageRow(row));
  }

  async reactToMessage(messageId: string, emoji: string | null): Promise<void> {
    const meId = await this.myId();
    if (emoji === null) {
      const { error } = await this.sb
        .from('message_reactions')
        .delete()
        .match({ message_id: messageId, user_id: meId });
      if (error) throw error;
      return;
    }
    // RLS makes sure it's a thread you're in and nobody is blocked.
    const { error } = await this.sb
      .from('message_reactions')
      .upsert(
        { message_id: messageId, user_id: meId, emoji, created_at: new Date().toISOString() },
        { onConflict: 'message_id,user_id' },
      );
    if (error) throw error;
  }

  async sendMessage(
    conversationId: string,
    input: { text?: string; sharedPostId?: string; sharedUserId?: string; imageUri?: string },
  ): Promise<Message> {
    const meId = await this.myId();
    const text = (input.text ?? '').trim().slice(0, 2000);
    if (!text && !input.sharedPostId && !input.sharedUserId && !input.imageUri) {
      throw new Error('Nothing to send.');
    }

    // Attachments go in the same per-user folder as post photos, so the
    // existing storage policy and its size/MIME limits already cover them.
    let imageUrl: string | null = null;
    if (input.imageUri) {
      imageUrl = input.imageUri.startsWith('http')
        ? input.imageUri
        : await this.uploadPhoto(input.imageUri, meId);
    }

    const { data, error } = await this.sb
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: meId,
        text,
        shared_post_id: input.sharedPostId ?? null,
        // Only sent when set, so an older database without the column still
        // takes ordinary messages.
        ...(input.sharedUserId ? { shared_user_id: input.sharedUserId } : {}),
        image_url: imageUrl,
      })
      .select(this.MESSAGE_SELECT)
      .single();
    if (error) throw error;

    // Keeps the inbox ordered by recency without joining messages.
    await this.sb
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    // Fire a push to the other (un-muted) members. Fire-and-forget: a failed or
    // slow push must never slow down or fail sending the message.
    this.sb.functions
      .invoke('notify-message', { body: { conversationId, messageId: (data as any).id } })
      .catch(() => {});

    return this.hydrateMessageRow(data);
  }

  async savePushToken(token: string, platform: string): Promise<void> {
    const meId = await this.myId();
    await this.sb
      .from('push_tokens')
      .upsert(
        { user_id: meId, token, platform, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,token' },
      );
  }

  async startConversation(userId: string): Promise<string> {
    // One atomic server-side call. A client-side insert can't work cleanly:
    // the creator isn't a member of the brand-new thread yet, so members-only
    // RLS both blocks the insert and can't return the new row. The RPC creates
    // the conversation and adds both members as the definer, while still
    // enforcing the follow + block rules itself. Its RAISE messages are already
    // user-facing sentences.
    const { data, error } = await this.sb.rpc('start_conversation', { target: userId });
    if (error) throw new Error(error.message || 'Could not start the conversation.');
    if (!data) throw new Error('Could not start the conversation.');
    return data as string;
  }

  async startGroupConversation(userIds: string[]): Promise<string> {
    // Same server-side, RLS-safe pattern as startConversation, for a whole
    // group at once. The RPC validates every member and reuses an existing
    // thread with exactly this set. Its RAISE messages are user-facing.
    const targets = [...new Set(userIds)];
    const { data, error } = await this.sb.rpc('start_group_conversation', { targets });
    if (error) throw new Error(error.message || 'Could not start the group chat.');
    if (!data) throw new Error('Could not start the group chat.');
    return data as string;
  }

  async sendFeedback(input: { kind: FeedbackKind; message: string }): Promise<void> {
    const meId = await this.myId();
    const message = clamp(input.message, 2000);
    if (!message) throw new Error('Please tell us what happened.');

    // Snapshot the handle: user_id is ON DELETE SET NULL so the report
    // outlives the account, and an anonymous row is much harder to act on.
    const { data: me } = await this.sb
      .from('users')
      .select('handle')
      .eq('id', meId)
      .maybeSingle();

    const { error } = await this.sb.from('feedback').insert({
      user_id: meId,
      handle_snapshot: (me as { handle?: string } | null)?.handle ?? null,
      kind: input.kind,
      message,
      app_version: appVersion(),
      platform: platformName(),
    });
    if (error) throw error;
  }

  async reportMessage(messageId: string, reason: ReportReason, detail?: string): Promise<void> {
    const meId = await this.myId();

    // Snapshot the message now: message_id is ON DELETE SET NULL, so without
    // this the sender could delete the message and empty out the report.
    const { data: msg } = await this.sb
      .from('messages')
      .select('sender_id, text, image_url')
      .eq('id', messageId)
      .maybeSingle();
    if (!msg) throw new Error('That message no longer exists.');

    const target = msg as { sender_id: string; text: string | null; image_url: string | null };
    if (target.sender_id === meId) throw new Error('You cannot report your own message.');

    const { error } = await this.sb.from('reports').insert({
      message_id: messageId,
      reporter_id: meId,
      reported_user_id: target.sender_id,
      reason,
      detail: detail?.trim() ? detail.trim().slice(0, 1000) : null,
      message_text_snapshot: target.text || null,
      message_image_url_snapshot: target.image_url,
    });
    if (error) throw error;
  }

  async reportComment(commentId: string, reason: ReportReason, detail?: string): Promise<void> {
    const meId = await this.myId();

    // Snapshot the comment now: comment_id is ON DELETE SET NULL, so without
    // this the author could delete the comment and empty out the report.
    const { data: c } = await this.sb
      .from('comments')
      .select('user_id, text')
      .eq('id', commentId)
      .maybeSingle();
    if (!c) throw new Error('That comment no longer exists.');

    const target = c as { user_id: string; text: string | null };
    if (target.user_id === meId) throw new Error('You cannot report your own comment.');

    const { error } = await this.sb.from('reports').insert({
      comment_id: commentId,
      reporter_id: meId,
      reported_user_id: target.user_id,
      reason,
      detail: detail?.trim() ? detail.trim().slice(0, 1000) : null,
      comment_text_snapshot: target.text || null,
    });
    if (error) throw error;
  }

  async reportUser(userId: string, reason: ReportReason, detail?: string): Promise<void> {
    const meId = await this.myId();
    if (userId === meId) throw new Error('You cannot report your own account.');

    // An account report stands on its own: no post, message or comment id.
    // reported_user_id carries who it is about, which is all a reviewer needs
    // to pull that account's history from the queue.
    const { error } = await this.sb.from('reports').insert({
      reporter_id: meId,
      reported_user_id: userId,
      reason,
      detail: detail?.trim() ? detail.trim().slice(0, 1000) : null,
    });
    if (error) throw error;
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

  async getConversationMembers(conversationId: string): Promise<User[]> {
    const { data } = await this.sb
      .from('conversation_members')
      .select('users(*)')
      .eq('conversation_id', conversationId);
    return (data ?? []).map((r: any) => r.users as User).filter(Boolean);
  }

  async getConversationMuted(conversationId: string): Promise<boolean> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('conversation_members')
      .select('muted')
      .match({ conversation_id: conversationId, user_id: meId })
      .maybeSingle();
    return Boolean((data as { muted?: boolean } | null)?.muted);
  }

  async setConversationMuted(conversationId: string, muted: boolean): Promise<void> {
    const meId = await this.myId();
    const { error } = await this.sb
      .from('conversation_members')
      .update({ muted })
      .match({ conversation_id: conversationId, user_id: meId });
    if (error) throw error;
  }

  async renameConversation(conversationId: string, title: string): Promise<void> {
    // Any member may name the thread — the "touch own conversations" update
    // policy already scopes this to members. Empty clears back to the members'
    // names; RLS returns nothing for a thread you are not in, so a patched
    // client cannot rename someone else's.
    const trimmed = title.trim().slice(0, 60);
    const { error } = await this.sb
      .from('conversations')
      .update({ title: trimmed.length ? trimmed : null })
      .eq('id', conversationId);
    if (error) throw new Error(error.message || 'Could not rename the group.');
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.leaveConversation(conversationId);
  }

  async leaveConversation(conversationId: string): Promise<void> {
    const meId = await this.myId();
    if (this.caps.leave) {
      // One server-side call: in a group it posts "<you> left the chat" for
      // the people still in it, then removes you. A client can't write that
      // line itself (RLS only lets it send ordinary messages).
      const { error } = await this.sb.rpc('leave_conversation', { conv: conversationId });
      if (error) throw new Error(error.message || 'Could not leave the chat.');
      return;
    }
    // Before migration 0025: just leave quietly. "leave conversations" RLS
    // lets you delete only your own membership, so this removes the thread
    // from your inbox without touching anyone else's.
    const { error } = await this.sb
      .from('conversation_members')
      .delete()
      .match({ conversation_id: conversationId, user_id: meId });
    if (error) throw error;
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

  /**
   * Top-level comments only, newest first, in pages — so a post with a thousand
   * comments doesn't load them all at once. Each carries its reply count; the
   * replies themselves load on demand via getReplies().
   */
  async getComments(postId: string, limit = 15, offset = 0): Promise<Comment[]> {
    const meId = await this.myId();
    const [{ data }, { data: post }] = await Promise.all([
      this.sb
        .from('comments')
        .select('*, users!comments_user_id_fkey(*), comment_reactions(user_id)')
        .eq('post_id', postId)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
      this.sb.from('posts').select('user_id').eq('id', postId).maybeSingle(),
    ]);
    const rows = (data ?? []) as any[];

    // One extra query for this page's reply counts, grouped client-side.
    const ids = rows.map((r) => r.id);
    const replyCounts: Record<string, number> = {};
    if (ids.length) {
      const { data: reps } = await this.sb
        .from('comments')
        .select('parent_id')
        .in('parent_id', ids);
      for (const r of (reps ?? []) as any[]) {
        replyCounts[r.parent_id] = (replyCounts[r.parent_id] ?? 0) + 1;
      }
    }

    const postOwnerId = (post as { user_id?: string } | null)?.user_id;
    return rows.map((row: any) => this.hydrateComment(row, meId, postOwnerId, replyCounts[row.id] ?? 0));
  }

  /** The replies under one top-level comment, oldest first. */
  async getReplies(parentId: string): Promise<Comment[]> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('comments')
      .select('*, users!comments_user_id_fkey(*), comment_reactions(user_id)')
      .eq('parent_id', parentId)
      .order('created_at', { ascending: true });
    const rows = (data ?? []) as any[];
    // Post owner (for the "delete on your own post" affordance).
    let postOwnerId: string | undefined;
    if (rows.length) {
      const { data: post } = await this.sb
        .from('posts')
        .select('user_id')
        .eq('id', rows[0].post_id)
        .maybeSingle();
      postOwnerId = (post as { user_id?: string } | null)?.user_id;
    }
    return rows.map((row: any) => this.hydrateComment(row, meId, postOwnerId, 0));
  }

  private hydrateComment(row: any, meId: string, postOwnerId?: string, replyCount = 0): Comment {
    return {
      ...(row as Comment),
      user: row.users as User,
      like_count: (row.comment_reactions ?? []).length,
      liked_by_me: (row.comment_reactions ?? []).some((r: any) => r.user_id === meId),
      // Mirrors the "delete own comment or on own post" RLS policy.
      can_delete: row.user_id === meId || postOwnerId === meId,
      reply_count: replyCount,
    };
  }

  async deleteComment(commentId: string): Promise<void> {
    // RLS decides whether this is allowed; no client-side check to bypass.
    const { error } = await this.sb.from('comments').delete().eq('id', commentId);
    if (error) throw error;
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

  async addComment(
    postId: string,
    text: string,
    imageUri?: string,
    parentId?: string | null,
  ): Promise<Comment> {
    const meId = await this.myId();
    const body = clamp(text, LIMITS.comment);
    if (!body && !imageUri) throw new Error('Nothing to post.');

    // Photos go in the same per-user folder as post/message photos, so the
    // existing storage policy and its size/MIME limits already cover them.
    let imageUrl: string | null = null;
    if (imageUri) {
      imageUrl = imageUri.startsWith('http') ? imageUri : await this.uploadPhoto(imageUri, meId);
    }

    const { data, error } = await this.sb
      .from('comments')
      .insert({
        post_id: postId,
        user_id: meId,
        text: body,
        image_url: imageUrl,
        parent_id: parentId ?? null,
      })
      .select('*, users!comments_user_id_fkey(*)')
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

  // ---------------------------------------------------------- collections

  /**
   * Attach counts and cover posts to collection rows: one query for every
   * item across them, one for the cover posts.
   */
  private async withCovers(rows: any[], meId: string): Promise<Collection[]> {
    if (!rows.length) return [];
    const { data: items } = await this.sb
      .from('collection_posts')
      .select('collection_id, post_id, added_at')
      .in('collection_id', rows.map((r) => r.id))
      .order('added_at', { ascending: false });
    const byCollection = new Map<string, string[]>();
    for (const it of items ?? []) {
      const list = byCollection.get(it.collection_id) ?? [];
      list.push(it.post_id);
      byCollection.set(it.collection_id, list);
    }
    const coverIds = [...byCollection.values()].map((ids) => ids[0]);
    const covers = new Map<string, Post>();
    if (coverIds.length) {
      const { data: posts } = await this.sb
        .from('posts')
        .select(this.POST_SELECT)
        .in('id', coverIds);
      for (const row of posts ?? []) covers.set((row as any).id, this.hydrateRow(row, meId));
    }
    return rows.map((r) => {
      const ids = byCollection.get(r.id) ?? [];
      return {
        id: r.id,
        user_id: r.user_id,
        name: r.name,
        created_at: r.created_at,
        post_count: ids.length,
        cover: ids.length ? covers.get(ids[0]) ?? null : null,
      };
    });
  }

  /** Readable message for a duplicate name (the unique index is case-blind). */
  private collectionError(error: any, name: string): Error {
    if (error?.code === '23505') {
      return new Error(`You already have a collection called ${tidyCollectionName(name)}`);
    }
    return error instanceof Error ? error : new Error(error?.message ?? 'Could not save that collection');
  }

  async getCollections(userId: string): Promise<Collection[]> {
    const meId = await this.myId();
    const { data, error } = await this.sb
      .from('collections')
      .select('id, user_id, name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return this.withCovers(data ?? [], meId);
  }

  async getCollection(collectionId: string): Promise<Collection | null> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('collections')
      .select('id, user_id, name, created_at')
      .eq('id', collectionId)
      .maybeSingle();
    if (!data) return null;
    return (await this.withCovers([data], meId))[0];
  }

  async getCollectionPosts(collectionId: string): Promise<Post[]> {
    const meId = await this.myId();
    const { data: items } = await this.sb
      .from('collection_posts')
      .select('post_id, added_at')
      .eq('collection_id', collectionId)
      .order('added_at', { ascending: false });
    const ids = (items ?? []).map((r: any) => r.post_id);
    if (!ids.length) return [];
    const { data: postsData } = await this.sb
      .from('posts')
      .select(this.POST_SELECT)
      .in('id', ids);
    const byId = new Map<string, Post>(
      (postsData ?? []).map((row: any) => [row.id, this.hydrateRow(row, meId)]),
    );
    // Keep the most-recently-added order; skip anything deleted or hidden.
    return ids
      .map((id: string) => byId.get(id))
      .filter((p: Post | undefined): p is Post => Boolean(p));
  }

  async createCollection(name: string): Promise<Collection> {
    const meId = await this.myId();
    // Checked here for a friendly message; the database enforces it anyway.
    const problem = collectionNameProblem(name);
    if (problem) throw new Error(problem);
    const { data, error } = await this.sb
      .from('collections')
      .insert({ user_id: meId, name: tidyCollectionName(name) })
      .select('id, user_id, name, created_at')
      .single();
    if (error) throw this.collectionError(error, name);
    return { ...(data as any), post_count: 0, cover: null };
  }

  async renameCollection(collectionId: string, name: string): Promise<void> {
    const problem = collectionNameProblem(name);
    if (problem) throw new Error(problem);
    const { error } = await this.sb
      .from('collections')
      .update({ name: tidyCollectionName(name) })
      .eq('id', collectionId);
    if (error) throw this.collectionError(error, name);
  }

  async deleteCollection(collectionId: string): Promise<void> {
    // collection_posts rows go with it (on delete cascade); the posts stay.
    const { error } = await this.sb.from('collections').delete().eq('id', collectionId);
    if (error) throw error;
  }

  async getPostCollectionIds(postId: string): Promise<string[]> {
    const meId = await this.myId();
    const { data } = await this.sb
      .from('collection_posts')
      .select('collection_id, collections!inner(user_id)')
      .eq('post_id', postId)
      .eq('collections.user_id', meId);
    return (data ?? []).map((r: any) => r.collection_id);
  }

  async setPostInCollection(collectionId: string, postId: string, inside: boolean): Promise<void> {
    // RLS only lets you add your own posts to your own collections.
    if (inside) {
      const { error } = await this.sb
        .from('collection_posts')
        .upsert(
          { collection_id: collectionId, post_id: postId },
          { onConflict: 'collection_id,post_id', ignoreDuplicates: true },
        );
      if (error) throw error;
    } else {
      const { error } = await this.sb
        .from('collection_posts')
        .delete()
        .match({ collection_id: collectionId, post_id: postId });
      if (error) throw error;
    }
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

  async getTaggedPosts(userId?: string): Promise<Post[]> {
    const meId = await this.myId();
    const who = userId ?? meId;
    // A database that hasn't run migration 0024 has no tags at all.
    if (!this.caps.tags) return [];
    const { data, error } = await this.sb
      .from('post_tags')
      .select('created_at, posts(' + this.POST_SELECT + ')')
      .eq('user_id', who)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? [])
      .map((r: any) => r.posts)
      .filter(Boolean)
      .map((row: any) => this.hydrateRow(row, meId));
  }

  async untagMe(postId: string): Promise<void> {
    const meId = await this.myId();
    // RLS lets the tagged person delete their own tag row.
    const { error } = await this.sb
      .from('post_tags')
      .delete()
      .match({ post_id: postId, user_id: meId });
    if (error) throw error;
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

  // ------------------------------------------------------- notifications
  // Written by database triggers, never from here: there is no insert policy
  // on the table, so the app couldn't forge one even if it tried.

  async getNotifications(): Promise<AppNotification[]> {
    // RLS already scopes this to me; the filter is belt and braces.
    const meId = await this.myId();
    const { data, error } = await this.sb
      .from('notifications')
      .select('*, actor:users!notifications_actor_id_fkey(*), posts(*), comments(text)')
      .eq('user_id', meId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    // Blocked actors are filtered by the RLS policy, not here.
    return (data ?? []).map((row: any) => ({
      ...(row as AppNotification),
      actor: row.actor as User,
      post: (row.posts as Post) ?? null,
      comment_text: row.comments?.text ?? null,
    }));
  }

  async getUnreadNotificationCount(): Promise<number> {
    const meId = await this.myId();
    const { count } = await this.sb
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', meId)
      .is('read_at', null);
    return count ?? 0;
  }

  async markNotificationsRead(): Promise<void> {
    const meId = await this.myId();
    await this.sb
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', meId)
      .is('read_at', null);
  }

  async clearNotifications(): Promise<void> {
    const meId = await this.myId();
    await this.sb.from('notifications').delete().eq('user_id', meId);
  }

  async deleteNotifications(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const meId = await this.myId();
    // The user_id filter is belt and braces: RLS already limits deletes to
    // your own rows.
    const { error } = await this.sb
      .from('notifications')
      .delete()
      .eq('user_id', meId)
      .in('id', ids);
    if (error) throw error;
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
