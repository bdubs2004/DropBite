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
