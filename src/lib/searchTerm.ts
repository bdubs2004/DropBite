/**
 * Make a user-typed search term safe to interpolate into a PostgREST filter.
 *
 * PostgREST parses `.or()` / `.ilike()` values as filter syntax, so raw input
 * lets a caller inject extra conditions: a comma starts a new filter,
 * parentheses open a group, and `.` separates column/operator/value. `%` and
 * `_` are also LIKE wildcards. Keep letters, numbers, spaces and a few
 * harmless marks; drop the rest and cap the length.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/[^\p{L}\p{N} _'-]/gu, '')
    .replace(/[_%]/g, '')
    .slice(0, 60)
    .trim();
}
