import { User } from '../types';

/** Lowercase, drop accents and a leading @, collapse spaces. */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Filter a people list by what's typed in its search box: matches a display
 * name or @handle anywhere in it ("mar", "@margesbakes", "halv", "jose" for
 * "José"). An empty query keeps everyone, in the original order.
 */
export function filterUsers(users: User[], query: string): User[] {
  const q = norm(query);
  if (!q) return users;
  return users.filter((u) => norm(u.display_name).includes(q) || norm(u.handle).includes(q));
}
