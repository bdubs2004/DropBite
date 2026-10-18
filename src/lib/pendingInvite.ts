import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The invite code (a friend's @handle) typed at sign-up, kept until the new
 * account can claim it. Sign-up often ends before there's a session (the
 * email still needs confirming), so the claim happens on the first signed-in
 * launch instead (AppContext).
 */
const KEY = 'niblgo.pendingInvite';

/** Letters, numbers and underscores, as handles are; '' when nothing usable. */
export function cleanInviteCode(raw: string): string {
  return raw.trim().replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30);
}

export async function rememberInvite(raw: string): Promise<void> {
  const code = cleanInviteCode(raw);
  try {
    if (code.length >= 2) await AsyncStorage.setItem(KEY, code);
  } catch {
    // Without it the referral just isn't recorded.
  }
}

export async function readInvite(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function clearInvite(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Harmless: claiming twice is refused by the server anyway.
  }
}
