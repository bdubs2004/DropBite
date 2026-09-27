/**
 * Auth deep-link parsing.
 *
 * Run with: npm run test:authlink
 */
import { parseAuthParams, sessionTokens } from '../authLink';

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

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nALL PASSED');
