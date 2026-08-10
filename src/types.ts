export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface User {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  /** In demo mode avatars can be an emoji instead of an image */
  avatar_emoji?: string | null;
  bio: string | null;
  timezone: string;
  /** When true, this user's followers/following lists are hidden from others. */
  follows_private?: boolean;
  created_at: string;
}

export interface Ingredient {
  item: string;
  quantity: string;
  unit: string;
}

export interface Recipe {
  id: string;
  post_id: string;
  title: string;
  ingredients: Ingredient[];
  steps: string[];
  cook_time_minutes: number | null;
  ai_generated: boolean;
  user_edited: boolean;
}

export interface Post {
  id: string;
  user_id: string;
  meal_slot: MealSlot;
  photo_url: string | null;
  /** Demo-mode placeholder: emoji + gradient instead of a real photo */
  photo_emoji?: string | null;
  blurb: string;
  restaurant_place_id: string | null;
  restaurant_name: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  /** Display-only engagement counts (comments/shares/reposts land in Phase 2) */
  comment_count?: number;
  share_count?: number;
  repost_count?: number;
  // hydrated client-side
  user?: User;
  recipe?: Recipe | null;
  reaction_count?: number;
  reacted_by_me?: boolean;
  reposted_by_me?: boolean;
  saved_by_me?: boolean;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  created_at: string;
  // hydrated client-side
  user?: User;
}

/**
 * Why a post was reported. Stored as a stable key, never a display string, so
 * the wording can change without rewriting historical moderation records.
 */
export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'sexual'
  | 'violence'
  | 'self_harm'
  | 'false_info'
  | 'intellectual_property'
  | 'other';

/** Where a report sits in the review queue. */
export type ReportStatus = 'open' | 'reviewing' | 'actioned' | 'dismissed';

export interface Report {
  id: string;
  /** Null once the post is deleted; the snapshot below preserves the evidence. */
  post_id: string | null;
  reporter_id: string;
  /** Author of the reported post, kept even if the post is gone. */
  reported_user_id: string | null;
  reason: ReportReason;
  /** Optional free-text context from the reporter. */
  detail: string | null;
  /** Copy of the post at report time, so deleting it can't destroy the record. */
  post_blurb_snapshot: string | null;
  post_photo_url_snapshot: string | null;
  status: ReportStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
}

export interface Streak {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_post_date: string | null; // YYYY-MM-DD in user's timezone
}

export interface PlaceResult {
  place_id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

export interface NotificationPrefs {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export interface NewPostInput {
  meal_slot: MealSlot;
  photo_url: string | null;
  photo_emoji?: string | null;
  blurb: string;
  restaurant?: PlaceResult | null;
  recipe?: Omit<Recipe, 'id' | 'post_id'> | null;
}
