import * as Crypto from 'expo-crypto';

/**
 * Password hashing for DEMO MODE only.
 *
 * Demo mode keeps its whole database in AsyncStorage on the device, including
 * sign-in credentials. Storing those in the clear is a real hazard even
 * locally: people reuse passwords, and on-disk data is readable via device
 * backups, a rooted device, or (on web) any script with localStorage access.
 *
 * This is deliberately NOT a production password scheme — SHA-256 is fast and
 * therefore weak against offline cracking. Real accounts go through Supabase
 * Auth (bcrypt, server-side); this file is unused when Supabase is configured.
 */
const SALT_BYTES = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function digest(salt: string, password: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
}

/** Hash a new password. Returns "salt:hash" for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = toHex(Crypto.getRandomBytes(SALT_BYTES));
  return `${salt}:${await digest(salt, password)}`;
}

/**
 * Check a password against a stored "salt:hash". The comparison is
 * length-constant — timing attacks aren't a realistic threat against local
 * storage, but doing it correctly costs nothing.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = await digest(salt, password);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
