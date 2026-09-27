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
