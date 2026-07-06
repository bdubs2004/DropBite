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
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';

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

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const user =
        mode === 'signup'
          ? await svc.signUp({
              email,
              password,
              handle,
              display_name: displayName,
            })
          : await svc.signIn(email, password);
      setUser(user);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const valid =
    email.includes('@') &&
    password.length >= 6 &&
    (mode === 'signin' || (handle.trim().length >= 2 && displayName.trim().length >= 1));

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <LogoMark size={76} />
          <Text style={styles.wordmark}>dropbite</Text>
          <Text style={styles.tagline}>
            Share what you actually cook and eat, meal by meal.
          </Text>
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
              />
              <Input
                label="Handle"
                placeholder="margesbakes"
                value={handle}
                onChangeText={setHandle}
                autoCapitalize="none"
                autoCorrect={false}
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
          />
          <Input
            label="Password"
            placeholder="At least 6 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
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
