import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LogoMark } from '../components/Logo';
import { Button, Input, Muted } from '../components/ui';
import { LIMITS } from '../lib/limits';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';

/**
 * Shown when a password-reset deep link (niblgo://reset#...) is opened. By the
 * time we get here App.tsx has already turned the recovery tokens into a live
 * session, so updateUser() has something to act on.
 *
 * `error` is set instead when the link was expired/used or carried no tokens;
 * we say so plainly and send them back rather than showing a dead form.
 * `onDone` clears the recovery state so the app renders normally afterwards.
 */
export function ResetPasswordScreen({
  error,
  onDone,
}: {
  error: string | null;
  onDone: () => void;
}) {
  const svc = getDataService();
  const { refreshMe } = useApp();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = password.length >= LIMITS.passwordMin && password === confirm;

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await svc.updatePassword(password);
      // The recovery session is now a full session — refresh so the app has
      // the signed-in user when we hand control back.
      await refreshMe();
      setDone(true);
    } catch (e: any) {
      const raw = String(e?.message ?? '');
      setFormError(
        /rate|too many/i.test(raw)
          ? 'Too many attempts. Wait a minute and try again.'
          : 'Could not set your password. The reset link may have expired — request a new one.',
      );
    } finally {
      setBusy(false);
    }
  };

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <LogoMark size={72} />
        </View>
        <View style={styles.card}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // Expired / invalid link.
  if (error) {
    return (
      <Frame>
        <Text style={styles.title}>Reset link expired</Text>
        <Muted style={styles.body}>
          This password reset link is no longer valid — links can only be used once,
          and some email scanners open them before you do. Head back and tap
          “Forgot password?” to get a fresh one.
        </Muted>
        <Button title="Back to sign in" onPress={onDone} style={{ marginTop: spacing.lg }} />
      </Frame>
    );
  }

  // Success.
  if (done) {
    return (
      <Frame>
        <Text style={styles.title}>Password updated</Text>
        <Muted style={styles.body}>You’re all set — your new password is saved.</Muted>
        <Button title="Continue" onPress={onDone} style={{ marginTop: spacing.lg }} />
      </Frame>
    );
  }

  // The form.
  return (
    <Frame>
      <Text style={styles.title}>Set a new password</Text>
      <Muted style={[styles.body, { marginBottom: spacing.lg }]}>
        Choose a new password for your NiblGo account.
      </Muted>
      <Input
        label="New password"
        placeholder={`At least ${LIMITS.passwordMin} characters`}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        maxLength={128}
      />
      <Input
        label="Confirm password"
        placeholder="Type it again"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        maxLength={128}
      />
      {confirm.length > 0 && password !== confirm ? (
        <Text style={styles.error}>Passwords don’t match.</Text>
      ) : null}
      {formError ? <Text style={styles.error}>{formError}</Text> : null}
      <Button
        title="Save new password"
        onPress={submit}
        disabled={!valid}
        loading={busy}
        style={{ marginTop: spacing.sm }}
      />
    </Frame>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  card: { backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.xl },
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.cocoa,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    textAlign: 'center',
    lineHeight: 21,
  },
  error: {
    fontFamily: fonts.bold,
    color: colors.danger,
    fontSize: 13.5,
    marginBottom: spacing.sm,
  },
});
