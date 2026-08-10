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
