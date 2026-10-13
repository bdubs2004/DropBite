/**
 * Auth deep-link parsing.
 *
 * Run with: npm run test:authlink
 */
import { jwtClaims, linkSessionAllowed, parseAuthParams, PendingAuth, sessionTokens } from '../authLink';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

// Implicit flow: tokens in the fragment (Supabase's own format).
check(
  'reads tokens from the fragment',
  (() => {
    const t = sessionTokens('niblgo://auth/confirm#access_token=aaa&refresh_token=bbb&type=signup');
    return !!t && t.access_token === 'aaa' && t.refresh_token === 'bbb';
  })(),
);

// A confirm page that forwards on the query string instead.
check(
  'reads tokens from the query string',
  (() => {
    const t = sessionTokens('niblgo://auth/confirm?access_token=aaa&refresh_token=bbb');
    return !!t && t.access_token === 'aaa' && t.refresh_token === 'bbb';
  })(),
);

// Both present: the fragment (Supabase's format) wins.
check(
  'fragment overrides the query on conflict',
  parseAuthParams('niblgo://auth/confirm?access_token=q#access_token=frag').access_token === 'frag',
);

// No tokens -> null, so the app knows it can't sign in from this link.
check('no tokens gives null', sessionTokens('niblgo://auth/confirm') === null);
check(
  'only an access token is not enough',
  sessionTokens('niblgo://auth/confirm#access_token=aaa') === null,
);

// Error links (expired / already used) surface their reason.
check(
  'reads an error from the fragment',
  parseAuthParams('niblgo://auth/confirm#error=access_denied&error_description=expired').error ===
    'access_denied',
);

// URL-encoded values are decoded.
check(
  'decodes percent-encoded values',
  parseAuthParams('niblgo://auth/confirm#error_description=link%20expired').error_description ===
    'link expired',
);

// ---- Which links may sign this phone in (session injection) ----
// base64url of the JSON's UTF-8 bytes (no Buffer: this file also type-checks with the app).
const b64url = (o: object) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = unescape(encodeURIComponent(JSON.stringify(o)))
    .split('')
    .map((c) => c.charCodeAt(0));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += A[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += A[n & 63];
  }
  return out;
};
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const tok = (claims: object) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;
const live = (email: string) => tok({ email, exp: NOW / 1000 + 3600, sub: 'u1' });
const waiting = (email: string, kind: PendingAuth['kind'] = 'confirm', ago = 60_000): PendingAuth => ({
  kind,
  email,
  at: NOW - ago,
});
const allowed = (o: Partial<Parameters<typeof linkSessionAllowed>[0]>) =>
  linkSessionAllowed({
    accessToken: live('sam@example.com'),
    kind: 'confirm',
    pending: waiting('sam@example.com'),
    signedIn: false,
    now: NOW,
    ...o,
  });

check('reads claims out of a token', jwtClaims(live('a@b.co'))?.email === 'a@b.co');
check('reads non-ASCII claims', jwtClaims(tok({ email: 'zoë@example.com' }))?.email === 'zoë@example.com');
check('garbage is not a token', jwtClaims('nope') === null && jwtClaims('a.%%%.c') === null);
check('the link this phone asked for signs it in', allowed({}) === true);
check('email case and spaces don\'t matter', allowed({ pending: waiting(' Sam@Example.com ') }) === true);
check('a link nobody on this phone asked for is ignored', allowed({ pending: null }) === false);
check(
  'someone else\'s account link is ignored (session injection)',
  allowed({ accessToken: live('attacker@evil.example') }) === false,
);
check('never replaces whoever is signed in', allowed({ signedIn: true }) === false);
check('a confirm link can\'t stand in for a reset (or back)', allowed({ kind: 'reset' }) === false);
check('waiting too long ago: ignored', allowed({ pending: waiting('sam@example.com', 'confirm', 3 * 24 * 3600_000) }) === false);
check('a request from the future: ignored', allowed({ pending: waiting('sam@example.com', 'confirm', -60_000) }) === false);
check(
  'an expired token: ignored',
  allowed({ accessToken: tok({ email: 'sam@example.com', exp: NOW / 1000 - 1 }) }) === false,
);
check('a token with no email: ignored', allowed({ accessToken: tok({ exp: NOW / 1000 + 3600 }) }) === false);
check('not a token at all: ignored', allowed({ accessToken: 'aaa' }) === false);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nALL PASSED');
