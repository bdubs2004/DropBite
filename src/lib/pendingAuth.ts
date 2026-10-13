import AsyncStorage from '@react-native-async-storage/async-storage';
import { PendingAuth } from './authLink';

/**
 * Remembers that this phone asked for a sign-up confirmation or a password
 * reset, and for which email, so only that link can sign it in (see
 * linkSessionAllowed). Stored because the app may be closed while the person
 * is in their mail app.
 */
const KEY = 'niblgo.pendingAuth';

export async function rememberPendingAuth(kind: PendingAuth['kind'], email: string): Promise<void> {
  try {
    const value: PendingAuth = { kind, email: email.trim().toLowerCase(), at: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Without it the link just won't sign them in; they can sign in by hand.
  }
}

export async function readPendingAuth(): Promise<PendingAuth | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && (v.kind === 'confirm' || v.kind === 'reset') && typeof v.email === 'string' && typeof v.at === 'number'
      ? (v as PendingAuth)
      : null;
  } catch {
    return null;
  }
}

export async function clearPendingAuth(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Harmless: it expires on its own.
  }
}
