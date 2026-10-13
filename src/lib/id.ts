import * as Crypto from 'expo-crypto';

/**
 * Local identifier generator (demo mode; production ids come from Postgres
 * gen_random_uuid()).
 *
 * Uses the platform CSPRNG rather than Math.random, which is seeded
 * predictably and not collision-safe. These ids become durable primary keys.
 */
export function uid(prefix = ''): string {
  const rand = Array.from(Crypto.getRandomBytes(8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

/**
 * A storage file name nobody can guess: 128 random bits from the platform
 * CSPRNG. Photos sit in a public bucket and load by URL, so a name built from
 * a timestamp could be found by trying the milliseconds around a known one
 * (DM and comment photos included).
 */
export function unguessableName(): string {
  return Array.from(Crypto.getRandomBytes(16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
