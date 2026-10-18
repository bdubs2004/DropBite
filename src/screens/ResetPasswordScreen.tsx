import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { LogoMark } from '../components/Logo';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { Button, Input, Muted } from '../components/ui';
import { passwordMeetsAll } from '../lib/passwordRules';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';

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
  const styles = useStyles();
  const svc = getDataService();
  const { refreshMe } = useApp();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = passwordMeetsAll(password) && password === confirm;

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
      // They stay on the form with what they typed: the reset session is still
      // good, so picking another password needs no new email.
      setFormError(resetErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Expired / invalid link.
  if (error) {
    return (
      <ResetFrame>
        <Text style={styles.title}>Reset link expired</Text>
        <Muted style={styles.body}>
          This password reset link is no longer valid. Links can only be used once,
          and some email scanners open them before you do. Head back and tap
          “Forgot password?” to get a fresh one.
        </Muted>
        <Button title="Back to sign in" onPress={onDone} style={{ marginTop: spacing.lg }} />
      </ResetFrame>
    );
  }

  // Success.
  if (done) {
    return (
      <ResetFrame>
        <Text style={styles.title}>Password updated</Text>
        <Muted style={styles.body}>You’re all set. Your new password is saved</Muted>
        <Button title="Continue" onPress={onDone} style={{ marginTop: spacing.lg }} />
      </ResetFrame>
    );
  }

  // The form.
  return (
    <ResetFrame>
      <Text style={styles.title}>Set a new password</Text>
      <Muted style={[styles.body, { marginBottom: spacing.lg }]}>
        Choose a new password for your NiblGo account.
      </Muted>
      <Input
        label="New password"
        placeholder="Create a new password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        maxLength={128}
      />
      <PasswordChecklist password={password} />
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
    </ResetFrame>
  );
}

/**
 * Why Supabase Auth refused the new password, in plain words. Only a real
 * session problem says the link may have expired; a password it won't take
 * (the current one, or too weak) says so, so the person just picks another.
 */
function resetErrorMessage(e: any): string {
  const code = String(e?.code ?? '');
  const raw = String(e?.message ?? '');
  if (code === 'same_password' || /different from the old password/i.test(raw)) {
    return 'That’s already your password. Choose a different one';
  }
  if (code === 'weak_password' || /weak|easy to guess/i.test(raw)) {
    return 'That password isn’t strong enough. Try a longer one with letters, numbers and a symbol';
  }
  if (Number(e?.status) === 429 || /rate|too many/i.test(raw)) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  return 'Could not set your password. The reset link may have expired, so request a new one.';
}

/**
 * The logo and card around each state of the screen. Declared out here, not
 * inside ResetPasswordScreen: a component created inside another is a new
 * component on every render, so React rebuilt the whole form on each keystroke
 * (the text box lost focus after one letter, and iOS cleared it on refocus).
 */
function ResetFrame({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.hero}>
          <LogoMark size={72} />
        </View>
        <View style={styles.card}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl },
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
}));
