import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DEMO_MODE, PRIVACY_URL, TERMS_URL } from '../config';
import { LogoMark } from '../components/Logo';
import { Button, Input, Muted } from '../components/ui';
import { LIMITS } from '../lib/limits';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turn a backend auth failure into something safe to show.
 *
 * Providers distinguish "no such user" from "wrong password" and say so.
 * Surfacing that verbatim turns sign-in into an account-existence oracle, so
 * sign-in failures always get one message. Sign-up does surface the specific
 * problems, because the user needs to act on them.
 */
function authErrorMessage(e: any, mode: 'signin' | 'signup'): string {
  const raw = String(e?.message ?? '');
  if (mode === 'signin') return 'Wrong email or password.';
  if (/handle/i.test(raw)) return raw;
  if (/already registered|already exists|user already/i.test(raw)) {
    return 'That email cannot be used. Try signing in instead.';
  }
  if (/password/i.test(raw)) return `Password must be at least ${LIMITS.passwordMin} characters.`;
  if (/rate|too many/i.test(raw)) return 'Too many attempts. Please wait a minute and try again.';
  return 'Could not create the account. Please check your details and try again.';
}

export function AuthScreen() {
  const { setUser } = useApp();
  const svc = getDataService();
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once sign-up succeeds but the account still needs confirming.
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  // Set when sign-in fails because the account was never confirmed.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  // Set to the address once a password-reset email goes out.
  const [resetSent, setResetSent] = useState<string | null>(null);
  // Shared cooldown/feedback for the resend + reset buttons.
  const [cooldown, setCooldown] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const resendConfirmation = async () => {
    if (cooldown > 0 || actionBusy) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await svc.resendConfirmation(unconfirmedEmail ?? email);
      setActionMsg('Sent — check your inbox, and your spam folder.');
    } catch (e: any) {
      const raw = String(e?.message ?? '');
      setActionMsg(
        /rate|too many|429/i.test(raw)
          ? 'Please wait a minute before trying again.'
          : 'Could not resend just now — try again in a moment.',
      );
    } finally {
      // Rate-limit either way so the button can't be hammered.
      setCooldown(60);
      setActionBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter your email above first, then tap “Forgot password?”.');
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      await svc.requestPasswordReset(email.trim());
      setResetSent(email.trim());
    } catch (e: any) {
      const raw = String(e?.message ?? '');
      setError(
        /rate|too many/i.test(raw)
          ? 'Too many requests. Wait a minute and try again.'
          : 'Could not send a reset email. Check the address and try again.',
      );
    } finally {
      setActionBusy(false);
    }
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const result = await svc.signUp({
          email,
          password,
          handle,
          display_name: displayName,
        });
        // Not an error: the account exists but is not usable until the link in
        // the email is clicked, so there is nobody to sign in yet.
        if (result.status === 'confirm_email') {
          setConfirmEmail(result.email);
          return;
        }
        setUser(result.user);
      } else {
        setUser(await svc.signIn(email, password));
      }
    } catch (e: any) {
      const raw = String(e?.message ?? '');
      // Unconfirmed accounts get a way forward (resend) instead of the generic
      // "wrong email or password" — this is the Outlook-Safe-Links case where a
      // scanner ate the one-time link before the user could tap it.
      if (mode === 'signin' && /not confirmed|confirm your email/i.test(raw)) {
        setUnconfirmedEmail(email.trim());
        return;
      }
      setError(authErrorMessage(e, mode));
    } finally {
      setBusy(false);
    }
  };

  const valid =
    EMAIL_RE.test(email.trim()) &&
    password.length >= LIMITS.passwordMin &&
    (mode === 'signin' || (handle.trim().length >= 2 && displayName.trim().length >= 1));

  // Sign-in blocked because the account was never confirmed. Offer a resend
  // instead of a dead end — their original link may have expired or been eaten
  // by a mail scanner.
  if (unconfirmedEmail) {
    return (
      <View style={[styles.scroll, styles.confirmRoot]}>
        <View style={styles.hero}>
          <LogoMark size={76} />
        </View>
        <View style={styles.card}>
          <Text style={styles.confirmTitle}>Confirm your email first</Text>
          <Text style={styles.confirmBody}>
            Your account isn’t verified yet. We can send a fresh link to{' '}
            <Text style={styles.confirmEmail}>{unconfirmedEmail}</Text>.
          </Text>
          {actionMsg ? <Text style={styles.confirmHint}>{actionMsg}</Text> : null}
          <Button
            title={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend confirmation email'}
            onPress={resendConfirmation}
            disabled={cooldown > 0}
            loading={actionBusy}
            style={{ marginTop: spacing.lg }}
          />
          <Button
            title="Back to sign in"
            variant="secondary"
            onPress={() => {
              setUnconfirmedEmail(null);
              setActionMsg(null);
            }}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      </View>
    );
  }

  // A password-reset email is on its way. It deep-links into the app, so tell
  // them to open it on their phone.
  if (resetSent) {
    return (
      <View style={[styles.scroll, styles.confirmRoot]}>
        <View style={styles.hero}>
          <LogoMark size={76} />
        </View>
        <View style={styles.card}>
          <Text style={styles.confirmTitle}>Check your email</Text>
          <Text style={styles.confirmBody}>
            We sent a password reset link to{' '}
            <Text style={styles.confirmEmail}>{resetSent}</Text>. Open it on your phone and
            you’ll land right back here to set a new password.
          </Text>
          <Text style={styles.confirmHint}>
            No email after a minute? Check your spam folder. Links can only be used once, so
            use the newest one.
          </Text>
          <Button
            title="Back to sign in"
            onPress={() => {
              setResetSent(null);
              setMode('signin');
            }}
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </View>
    );
  }

  // The account exists but is not usable until they click the link, so there
  // is nothing to sign in to yet. Say that plainly rather than dumping them
  // back on a form that would now fail with "email not confirmed".
  if (confirmEmail) {
    return (
      <View style={[styles.scroll, styles.confirmRoot]}>
        <View style={styles.hero}>
          <LogoMark size={76} />
        </View>
        <View style={styles.card}>
          <Text style={styles.confirmTitle}>Check your email</Text>
          <Text style={styles.confirmBody}>
            We sent a confirmation link to{' '}
            <Text style={styles.confirmEmail}>{confirmEmail}</Text>. Tap it, then come back and
            sign in.
          </Text>
          <Text style={styles.confirmHint}>
            No email after a minute or two? Check your spam folder, and make sure the address is
            right — you can start again with a different one.
          </Text>
          <Button
            title="Back to sign in"
            testID="confirm-back"
            onPress={() => {
              setConfirmEmail(null);
              setMode('signin');
              setPassword('');
            }}
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <LogoMark size={76} />
          <Text style={styles.wordmark}>NiblGo</Text>
          <Text style={styles.tagline}>Share bites. Discover favorites. Connect over food.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, mode === 'signup' && styles.tabActive]}
              onPress={() => setMode('signup')}
            >
              <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>
                Create account
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, mode === 'signin' && styles.tabActive]}
              onPress={() => setMode('signin')}
            >
              <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>
                Sign in
              </Text>
            </Pressable>
          </View>

          {mode === 'signup' ? (
            <>
              <Input
                label="Display name"
                placeholder="Marge Halvorson"
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                maxLength={LIMITS.displayName}
              />
              <Input
                label="Handle"
                placeholder="margesbakes"
                value={handle}
                onChangeText={setHandle}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={LIMITS.handle}
              />
            </>
          ) : null}

          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            maxLength={254}
          />
          <Input
            label="Password"
            placeholder={`At least ${LIMITS.passwordMin} characters`}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            maxLength={128}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            title={mode === 'signup' ? 'Create account' : 'Sign in'}
            onPress={submit}
            disabled={!valid}
            loading={busy}
            style={{ marginTop: spacing.sm }}
          />

          {mode === 'signin' ? (
            <Pressable
              onPress={forgotPassword}
              disabled={actionBusy}
              style={{ marginTop: spacing.md, alignSelf: 'center' }}
              hitSlop={8}
            >
              <Text style={styles.forgot}>Forgot password?</Text>
            </Pressable>
          ) : null}

          {mode === 'signup' ? (
            <Text style={styles.legal}>
              By creating an account you agree to our{' '}
              <Text
                style={styles.legalLink}
                onPress={() => Linking.openURL(TERMS_URL)}
                accessibilityRole="link"
              >
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text
                style={styles.legalLink}
                onPress={() => Linking.openURL(PRIVACY_URL)}
                accessibilityRole="link"
              >
                Privacy Policy
              </Text>
              .
            </Text>
          ) : null}

          {DEMO_MODE ? (
            <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>
              Demo mode: everything is stored on this device. See SETUP_GUIDE.md to
              connect the live backend.
            </Muted>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  legal: {
    fontFamily: fonts.semi,
    fontSize: 12,
    lineHeight: 17,
    color: colors.cocoaFaint,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  legalLink: { color: colors.amberDark, textDecorationLine: 'underline' },
  forgot: {
    fontFamily: fonts.bold,
    fontSize: 13.5,
    color: colors.amberDark,
  },
  confirmRoot: { flex: 1, justifyContent: 'center' },
  confirmTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.cocoa,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  confirmBody: {
    fontFamily: fonts.semi,
    fontSize: 15,
    lineHeight: 22,
    color: colors.cocoa,
    textAlign: 'center',
  },
  confirmEmail: { fontFamily: fonts.bold, color: colors.amberDark },
  confirmHint: {
    fontFamily: fonts.semi,
    fontSize: 13,
    lineHeight: 19,
    color: colors.cocoaFaint,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  wordmark: {
    fontFamily: fonts.wordmark,
    fontSize: 38,
    color: colors.cocoa,
    marginTop: spacing.sm,
    letterSpacing: -0.5,
  },
  tagline: {
    fontFamily: fonts.semi,
    fontSize: 14.5,
    color: colors.cocoaSoft,
    textAlign: 'center',
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.cream,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.xl,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.amber,
  },
  tabText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.cocoaSoft,
  },
  tabTextActive: {
    color: colors.white,
  },
  error: {
    fontFamily: fonts.bold,
    color: colors.danger,
    marginBottom: spacing.sm,
    fontSize: 13.5,
  },
});
