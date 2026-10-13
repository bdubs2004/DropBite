/**
 * Parse auth parameters out of a deep link.
 *
 * Supabase hands the session back in the URL fragment (implicit flow:
 * `#access_token=…&refresh_token=…`), but the web confirm page that forwards
 * the link into the app might pass them on the query string instead
 * (`?access_token=…`), and an expired link comes back as `#error=…`. So we
 * read BOTH the query and the fragment and merge them — the fragment wins on
 * conflict, since that's Supabase's own format.
 *
 * Kept pure (no expo-linking) so it can be unit-tested.
 */
export function parseAuthParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const grab = (s: string) => {
    for (const pair of s.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const k = eq < 0 ? pair : pair.slice(0, eq);
      const v = eq < 0 ? '' : pair.slice(eq + 1);
      try {
        out[decodeURIComponent(k)] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  };

  const hashAt = url.indexOf('#');
  const queryAt = url.indexOf('?');

  if (queryAt >= 0) {
    // Query runs from '?' up to the fragment, if any comes after it.
    const end = hashAt > queryAt ? hashAt : undefined;
    grab(url.slice(queryAt + 1, end));
  }
  if (hashAt >= 0) {
    grab(url.slice(hashAt + 1));
  }
  return out;
}

/** The tokens needed to establish a session, if this link carries them. */
export function sessionTokens(url: string): { access_token: string; refresh_token: string } | null {
  const p = parseAuthParams(url);
  if (p.access_token && p.refresh_token) {
    return { access_token: p.access_token, refresh_token: p.refresh_token };
  }
  return null;
}

/**
 * The claims inside a JWT, without checking its signature (the server does
 * that when the session is set). Null if it isn't a readable JWT.
 */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0;
    let value = 0;
    let pct = '';
    for (const ch of b64) {
      if (ch === '=') break;
      const i = ALPHABET.indexOf(ch);
      if (i < 0) return null;
      value = (value << 6) | i;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        pct += '%' + ((value >> bits) & 0xff).toString(16).padStart(2, '0');
      }
    }
    const parsed = JSON.parse(decodeURIComponent(pct));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** What this phone is waiting for: a sign-up confirmation or a password reset. */
export type PendingAuth = { kind: 'confirm' | 'reset'; email: string; at: number };

/** How long after asking a link may still sign this phone in. */
export const PENDING_AUTH_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * May a session handed over in a deep link sign this phone in?
 *
 * Anyone can build a niblgo://auth/confirm#access_token=… link from their own
 * account's tokens and send it to someone. Opening it would quietly sign the
 * victim into the attacker's account, and whatever they posted or messaged
 * next would land there. So a link only counts when this phone asked for one:
 * nobody is signed in, this phone is waiting for that kind of link, for the
 * same email, asked for recently, and the token itself hasn't expired.
 */
export function linkSessionAllowed(args: {
  accessToken: string;
  kind: PendingAuth['kind'];
  pending: PendingAuth | null;
  signedIn: boolean;
  now: number;
}): boolean {
  const { accessToken, kind, pending, signedIn, now } = args;
  if (signedIn || !pending || pending.kind !== kind) return false;
  if (!(now - pending.at >= 0 && now - pending.at <= PENDING_AUTH_MAX_AGE_MS)) return false;
  const claims = jwtClaims(accessToken);
  if (!claims) return false;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || email !== pending.email.trim().toLowerCase()) return false;
  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  return exp * 1000 > now;
}
