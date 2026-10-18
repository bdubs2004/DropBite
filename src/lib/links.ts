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

// Post ids are UUIDs (short ones in demo mode); nothing else gets through.
const POST_IN_URL = /(?:^|\/)post\/([A-Za-z0-9-]{2,64})\/?(?:[?#]|$)/;

/**
 * The post a link points at, and who shared it (?from=, only if it could be a
 * handle), for any form of post link: niblgo://post/<id>, the website's
 * https://niblgo.com/post/<id>, or the web build's /post/<id>. Null for any
 * other link.
 */
export function postLinkFrom(url: string | null | undefined): { postId: string; from: string | null } | null {
  if (!url) return null;
  const m = url.match(POST_IN_URL);
  if (!m) return null;
  let from: string | null = null;
  const q = url.match(/[?&]from=([^&#]*)/);
  if (q) {
    try {
      const h = decodeURIComponent(q[1]).replace(/^@+/, '');
      if (/^[A-Za-z0-9_]{2,30}$/.test(h)) from = h;
    } catch {
      from = null;
    }
  }
  return { postId: m[1], from };
}

/** Public URL for a profile. */
export function userUrl(userId: string): string {
  return `${APP_LINK_BASE}/u/${encodeURIComponent(userId)}`;
}
