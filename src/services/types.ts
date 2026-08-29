import {
  AppNotification,
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
    patch: Partial<
      Pick<User, 'display_name' | 'bio' | 'avatar_emoji' | 'avatar_url' | 'follows_private'>
    >,
  ): Promise<User>;
  /**
   * Upload a local image as the user's profile picture and save it.
   * Storage details stay in the service so screens only handle a local URI.
   */
  setAvatar(localUri: string): Promise<User>;

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
  getPost(postId: string): Promise<Post | null>;
  /** Everyone's posts, newest first — the Discover grid, not just your feed. */
  getDiscoverPosts(): Promise<Post[]>;
  /** Search every post by description, recipe title, or ingredient. */
  searchPosts(query: string): Promise<Post[]>;
  /** People to discover, each with a few recent posts and follow state. */
  getDiscoverPeople(): Promise<DiscoverPerson[]>;
  createPost(input: NewPostInput): Promise<Post>;
  /** Delete one of your own posts, and everything attached to it. */
  deletePost(postId: string): Promise<void>;
  toggleReaction(postId: string): Promise<void>;

  // engagement (comments, reposts, shares)
  getComments(postId: string): Promise<Comment[]>;
  addComment(postId: string, text: string): Promise<Comment>;
  /** Like/unlike a comment. Idempotent per user. */
  toggleCommentLike(commentId: string): Promise<void>;
  /** Delete a comment you wrote, or any comment on a post you own. */
  deleteComment(commentId: string): Promise<void>;
  toggleRepost(postId: string): Promise<void>;
  recordShare(postId: string): Promise<void>;

  // direct messages
  /** My threads, most recently active first. */
  getConversations(): Promise<Conversation[]>;
  getMessages(conversationId: string): Promise<Message[]>;
  sendMessage(
    conversationId: string,
    input: { text?: string; sharedPostId?: string; imageUri?: string },
  ): Promise<Message>;
  /** Find my existing 1:1 thread with this user, or start one. */
  /**
   * Open (or reuse) a 1:1 thread. You can only start one with someone you
   * follow — enforced in RLS, mirrored here for a readable error.
   */
  startConversation(userId: string): Promise<string>;
  /** Send one post to several people at once (the share sheet). */
  sharePostToUsers(postId: string, userIds: string[]): Promise<void>;
  markConversationRead(conversationId: string): Promise<void>;
  /**
   * Remove a thread from YOUR inbox by leaving it. The other person keeps
   * their copy — one side cannot destroy the other's history.
   */
  deleteConversation(conversationId: string): Promise<void>;
  /** Total unread messages across all threads, for the inbox badge. */
  getUnreadCount(): Promise<number>;

  // moderation
  /**
   * Report a post for review. Write-only from the client: reporters never see
   * the queue, and the reported user is never told who filed it.
   * Reporting the same post twice is a no-op rather than an error.
   */
  reportPost(postId: string, reason: ReportReason, detail?: string): Promise<void>;
  /** Report a direct message. Snapshots its content so the report survives a delete. */
  reportMessage(messageId: string, reason: ReportReason, detail?: string): Promise<void>;
  /**
   * Block a user. Symmetric in effect: neither of you sees the other's posts
   * or comments, follows are severed, and neither can message the other.
   */
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
  /** Users I have blocked. The blocked party can never see this. */
  getBlockedUsers(): Promise<User[]>;
  isBlocked(userId: string): Promise<boolean>;

  // saved posts (bookmarks) — private to the user
  toggleSave(postId: string): Promise<void>;
  getSavedPosts(): Promise<Post[]>; // my saved posts, most recently saved first
  /** Posts I've liked, most recently liked first. Private to me. */
  getLikedPosts(): Promise<Post[]>;
  /** Posts I've commented on, most recent comment first. Private to me. */
  getCommentedPosts(): Promise<Post[]>;

  // notifications — someone interacted with your post
  /** Newest first. Only ever your own; the database enforces that. */
  getNotifications(): Promise<AppNotification[]>;
  /** How many you haven't seen. Drives the badge on the bell. */
  getUnreadNotificationCount(): Promise<number>;
  /** Mark everything read. Called when you open the list. */
  markNotificationsRead(): Promise<void>;
  /** Clear the list. */
  clearNotifications(): Promise<void>;

  // streaks
  getStreak(userId: string): Promise<Streak>;
  /**
   * Streak rankings, highest first. 'friends' is you plus the people you
   * follow; 'everyone' is the whole app.
   */
  getLeaderboard(scope: LeaderboardScope): Promise<LeaderboardEntry[]>;

  // settings
  getNotificationPrefs(): Promise<NotificationPrefs>;
  setNotificationPrefs(prefs: NotificationPrefs): Promise<void>;
}
