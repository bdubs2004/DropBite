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

/**
 * Recent dish search *terms*, newest first.
 *
 * The People tab remembers profiles you opened; the Dishes tab has no profile
 * to remember, so instead it remembers the words you searched once you tapped
 * into a result — so "what did I look up last time" is one tap away. Same
 * device-only, small-and-scannable rules as the profile list above.
 */
const TERMS_KEY = 'niblgo.recent.terms.v1';

export async function getRecentTerms(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(TERMS_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(list) ? list.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Record a dish term you searched. Re-searching it moves it back to the top. */
export async function addRecentTerm(term: string): Promise<void> {
  const t = term.trim();
  if (!t) return;
  try {
    const list = await getRecentTerms();
    // Case-insensitive de-dupe so "Pizza" and "pizza" don't both pile up.
    const lower = t.toLowerCase();
    const next = [t, ...list.filter((x) => x.toLowerCase() !== lower)].slice(0, MAX);
    await AsyncStorage.setItem(TERMS_KEY, JSON.stringify(next));
  } catch {
    // A missing convenience list is not worth surfacing.
  }
}

export async function removeRecentTerm(term: string): Promise<void> {
  try {
    const list = await getRecentTerms();
    await AsyncStorage.setItem(TERMS_KEY, JSON.stringify(list.filter((x) => x !== term)));
  } catch {
    /* ignore */
  }
}

export async function clearRecentTerms(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TERMS_KEY);
  } catch {
    /* ignore */
  }
}
