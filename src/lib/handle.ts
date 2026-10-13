import { LIMITS } from './limits';

/**
 * Handles: letters, numbers and underscores, up to LIMITS.handle long.
 *
 * Capitals are kept exactly as typed ("JoeMama" stays "JoeMama"), but two
 * handles that differ only in capitals are the same handle: you can't sign up
 * as "joemama" once "JoeMama" exists, and searching ignores capitals. The
 * database enforces the same rule (unique on lower(handle)).
 */
export function cleanHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, LIMITS.handle);
}

/** Whether two handles are the same handle (capitals don't count). */
export function sameHandle(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Handles that would look like the team ("admin", "support", anything with
 * "niblgo"). The database refuses these from the app (migration 0035); this
 * mirrors it so sign-up can say so straight away.
 */
const RESERVED = new Set([
  'admin', 'admins', 'administrator', 'root', 'system', 'support', 'help', 'helpdesk',
  'contact', 'official', 'moderator', 'moderators', 'mod', 'mods', 'staff', 'team',
  'security', 'safety', 'trust', 'abuse', 'legal', 'privacy', 'terms', 'api', 'www',
  'app', 'auth', 'login', 'signup', 'settings', 'about', 'null', 'undefined',
  'anonymous', 'everyone', 'here', 'feed', 'inbox', 'discover', 'search', 'streaks',
  'notifications', 'activity', 'post', 'posts', 'me', 'u',
]);

export function isReservedHandle(handle: string): boolean {
  const h = handle.toLowerCase();
  return h.includes('niblgo') || RESERVED.has(h);
}

/**
 * A usable starting point for a handle: the reserved word taken out if there
 * is one ("niblgofan" -> "fan"), or "user" if nothing is left. The caller adds
 * numbers on a clash, so this must never itself be reserved.
 */
export function unreservedBase(handle: string): string {
  if (!isReservedHandle(handle)) return handle;
  const stripped = handle.replace(/niblgo/gi, '').replace(/^_+|_+$/g, '');
  return stripped.length >= 2 && !isReservedHandle(stripped) ? stripped : 'user';
}
