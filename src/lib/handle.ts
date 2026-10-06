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
