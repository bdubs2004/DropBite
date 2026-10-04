import { Post } from '../types';

/**
 * Hands a list of posts from a grid to the post screen, so tapping a tile opens
 * a scrollable mini feed (that post first, the rest of the grid above and below
 * it) instead of a single post.
 *
 * The list stays in memory rather than going through navigation params: a big
 * array of posts in params is slow to serialize and the grid already has them
 * loaded. If the list is gone (the app restarted), the screen falls back to
 * showing just the one post.
 */

const lists = new Map<string, Post[]>();
let nextKey = 0;

/** How far back above the tapped post the mini feed reaches. */
export const POSTS_BEFORE = 30;

export function stashPosts(posts: Post[]): string {
  const key = `feed-${++nextKey}`;
  lists.set(key, posts);
  // Keep only the most recent few lists; older screens fall back gracefully.
  if (lists.size > 10) lists.delete(lists.keys().next().value as string);
  return key;
}

export function takePosts(key: string | undefined): Post[] | null {
  return key ? lists.get(key) ?? null : null;
}

/**
 * The slice of the grid to show and where the tapped post sits in it. Capped
 * above the tapped post so opening the 300th tile doesn't render 300 cards
 * before you see anything.
 */
export function feedWindow(posts: Post[], startId: string): { posts: Post[]; index: number } {
  const at = posts.findIndex((p) => p.id === startId);
  if (at < 0) return { posts: [], index: 0 };
  const from = Math.max(0, at - POSTS_BEFORE);
  return { posts: posts.slice(from), index: at - from };
}

/** Navigate to a post from a grid, opening the grid as a mini feed. */
export function openPostFeed(
  navigation: { navigate: (name: string, params: object) => void },
  posts: Post[],
  postId: string,
  title?: string,
) {
  navigation.navigate('PostDetail', { postId, feedKey: stashPosts(posts), title });
}
