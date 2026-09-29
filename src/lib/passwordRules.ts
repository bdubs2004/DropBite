import { LIMITS } from './limits';

/**
 * Password requirements, in one place, so the live checklist on the sign-up and
 * reset screens and the "can submit" gate never disagree.
 *
 * The database (Supabase Auth) is still the authority — set a matching minimum
 * and "letters, digits and symbols" requirement under Authentication →
 * Providers → Email so a scripted client can't skip these — but these drive the
 * friendly checklist the user sees as they type.
 */
const SPECIAL = /[!@#$%^&*()_+\-=[\]{}|;:'",.<>/?`~\\]/;

export type PasswordRule = {
  key: string;
  label: string;
  test: (pw: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  {
    key: 'length',
    label: `At least ${LIMITS.passwordMin} characters`,
    test: (pw) => pw.length >= LIMITS.passwordMin,
  },
  { key: 'number', label: 'A number (0–9)', test: (pw) => /[0-9]/.test(pw) },
  {
    key: 'special',
    label: 'A special character (! @ # $ %)',
    test: (pw) => SPECIAL.test(pw),
  },
];

/** Each rule with whether the given password meets it — for the UI checklist. */
export function passwordChecks(pw: string): { key: string; label: string; met: boolean }[] {
  return PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, met: r.test(pw) }));
}

/** True only when the password satisfies every rule. */
export function passwordMeetsAll(pw: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(pw));
}
