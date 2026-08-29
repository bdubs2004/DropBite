import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types';

/**
 * Recently opened profiles from Search, newest first.
 *
 * Stored on the device only — this is a convenience, not data anyone else
 * should see, so it never goes to the server. Kept to a handful of entries so
 * the list stays scannable and the stored blob stays small.
 */
const KEY = 'niblgo.recent.searches.v1';
const MAX = 8;

type RecentUser = Pick<User, 'id' | 'handle' | 'display_name' | 'avatar_url' | 'avatar_emoji'>;

export async function getRecentSearches(): Promise<RecentUser[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentUser[]) : [];
    return Array.isArray(list) ? list.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Record a profile you opened. Re-opening one moves it back to the top. */
export async function addRecentSearch(user: User): Promise<void> {
  try {
    const list = await getRecentSearches();
    const entry: RecentUser = {
      id: user.id,
      handle: user.handle,
      display_name: user.display_name,
      avatar_url: user.avatar_url ?? null,
      avatar_emoji: user.avatar_emoji ?? null,
    };
    const next = [entry, ...list.filter((u) => u.id !== user.id)].slice(0, MAX);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A missing convenience list is not worth surfacing.
  }
}

export async function removeRecentSearch(userId: string): Promise<void> {
  try {
    const list = await getRecentSearches();
    await AsyncStorage.setItem(KEY, JSON.stringify(list.filter((u) => u.id !== userId)));
  } catch {
    /* ignore */
  }
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
