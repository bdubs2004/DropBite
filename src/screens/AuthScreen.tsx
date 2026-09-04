import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DEMO_MODE } from '../config';
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
      setError(authErrorMessage(e, mode));
    } finally {
      setBusy(false);
    }
  };

  const valid =
    EMAIL_RE.test(email.trim()) &&
    password.length >= LIMITS.passwordMin &&
    (mode === 'signin' || (handle.trim().length >= 2 && displayName.trim().length >= 1));

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
