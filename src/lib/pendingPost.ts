import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A shared post someone opened while signed out (or before they had an
 * account). Kept until they're in, then the app opens it (App.tsx), so the
 * link they tapped still leads to the post, even when signing up means
 * confirming an email and coming back on a later launch. `from` is who shared
 * it, offered as the invite code at sign-up.
 */
const KEY = 'niblgo.pendingPost';

export type PendingPost = { postId: string; from: string | null };

// The sign-in screen may already be up when a link arrives; it listens here.
const listeners = new Set<() => void>();
export function onPendingPost(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function rememberPost(link: PendingPost): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...link, at: Date.now() }));
  } catch {
    // Without it they just land on the feed after signing in.
  }
  listeners.forEach((fn) => fn());
}

/** The waiting post, if it's from the last week (an old one would surprise). */
export async function readPost(): Promise<PendingPost | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.postId !== 'string' || Date.now() - Number(v.at) > 7 * 86400e3) return null;
    return { postId: v.postId, from: typeof v.from === 'string' ? v.from : null };
  } catch {
    return null;
  }
}

export async function clearPost(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Harmless: it expires on its own.
  }
}
