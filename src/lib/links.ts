import { APP_LINK_BASE } from '../config';

/**
 * Deep links.
 *
 * One place builds the URLs and one config consumes them (see linking in
 * App.tsx), so a path can never drift between the two.
 */

/** Paths, shared by the navigation linking config and the builders below. */
export const LINK_PATHS = {
  post: 'post/:postId',
  user: 'u/:userId',
} as const;

/** Public URL for a post — what gets shared outside the app. */
export function postUrl(postId: string): string {
  return `${APP_LINK_BASE}/post/${encodeURIComponent(postId)}`;
}

/** Public URL for a profile. */
export function userUrl(userId: string): string {
  return `${APP_LINK_BASE}/u/${encodeURIComponent(userId)}`;
}
