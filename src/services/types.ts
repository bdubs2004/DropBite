import {
  Comment,
  NewPostInput,
  NotificationPrefs,
  Post,
  Streak,
  User,
} from '../types';

/**
 * Everything the UI needs from a backend. Two implementations:
 *  - MockService (demo mode, AsyncStorage, seeded data, zero keys needed)
 *  - SupabaseService (production, activated by EXPO_PUBLIC_SUPABASE_* env vars)
 */
export interface DataService {
  // auth/session
  getCurrentUser(): Promise<User | null>;
  signUp(input: {
    email: string;
    password: string;
    handle: string;
    display_name: string;
    avatar_emoji?: string;
  }): Promise<User>;
  signIn(email: string, password: string): Promise<User>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  exportMyData(): Promise<string>; // JSON string of everything the user owns

  // profile
  updateProfile(
    patch: Partial<Pick<User, 'display_name' | 'bio' | 'avatar_emoji' | 'follows_private'>>,
  ): Promise<User>;

  // social graph
  listUsers(query?: string): Promise<User[]>;
  getFollowingIds(): Promise<string[]>;
  follow(userId: string): Promise<void>;
  unfollow(userId: string): Promise<void>;
  getFollowCounts(userId: string): Promise<{ followers: number; following: number }>;
  getFollowers(userId: string): Promise<User[]>; // users who follow userId
  getFollowingUsers(userId: string): Promise<User[]>; // users userId follows

  // posts
  getFeed(): Promise<Post[]>; // me + people I follow, newest first
  getUserPosts(userId: string): Promise<Post[]>;
  createPost(input: NewPostInput): Promise<Post>;
  toggleReaction(postId: string): Promise<void>;

  // engagement (comments, reposts, shares)
  getComments(postId: string): Promise<Comment[]>;
  addComment(postId: string, text: string): Promise<Comment>;
  toggleRepost(postId: string): Promise<void>;
  recordShare(postId: string): Promise<void>;

  // streaks
  getStreak(userId: string): Promise<Streak>;

  // settings
  getNotificationPrefs(): Promise<NotificationPrefs>;
  setNotificationPrefs(prefs: NotificationPrefs): Promise<void>;
}
