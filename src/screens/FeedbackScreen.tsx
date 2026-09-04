import { Ionicons } from '@expo/vector-icons';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Muted } from '../components/ui';
import { appVersion, platformName } from '../lib/appInfo';
import { getDataService } from '../services';
import { colors, fonts, radius, spacing } from '../theme';
import { FeedbackKind } from '../types';

/**
 * Send feedback, or report something broken.
 *
 * Separate from ReportScreen on purpose: that one is a moderation queue about
 * other people's content and is a legal record. This is the user telling us the
 * app itself is wrong, and it goes to a different table with a different
 * lifecycle. Both reachable from Help at the bottom of the profile drawer.
 */
export function FeedbackScreen({ navigation, route }: any) {
  const svc = getDataService();
  const insets = useSafeAreaInsets();
  const initialKind: FeedbackKind = route?.params?.kind === 'bug' ? 'bug' : 'feedback';

  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = message.trim().length >= 3 && !sending;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await svc.sendFeedback({ kind, message });
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not send that. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <View style={[styles.root, styles.doneRoot, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.doneIcon}>
          <Ionicons name="checkmark" size={34} color={colors.white} />
        </View>
        <Text style={styles.doneTitle}>Thank you</Text>
        <Muted style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
          {kind === 'bug'
            ? 'We have got the details and will take a look. If it stopped you doing something, try again in a little while.'
            : 'Your note went straight to the team. We read every one.'}
        </Muted>
        <Button
          title="Done"
          onPress={() => navigation.goBack()}
          style={{ marginTop: spacing.xl, alignSelf: 'stretch' }}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.headerRow, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Help</Text>
          <View style={{ width: 50 }} />
        </View>

        <View style={styles.tabs}>
          <Tab
            label="Feedback"
            hint="An idea, or something you liked"
            active={kind === 'feedback'}
            onPress={() => setKind('feedback')}
            testID="feedback-tab-feedback"
          />
          <Tab
            label="Report a problem"
            hint="Something is broken"
            active={kind === 'bug'}
            onPress={() => setKind('bug')}
            testID="feedback-tab-bug"
          />
        </View>

        <Text style={styles.label}>
          {kind === 'bug' ? 'What went wrong?' : 'What is on your mind?'}
        </Text>
        <Input
          testID="feedback-message"
          placeholder={
            kind === 'bug'
              ? 'What were you doing, and what happened instead?'
              : 'Tell us anything — what you want, what is confusing, what you love'
          }
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={2000}
          style={styles.textarea}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title={sending ? 'Sending' : 'Send'}
          testID="feedback-send"
          onPress={submit}
          disabled={!canSend}
          loading={sending}
        />

        <View style={styles.meta}>
          <Ionicons name="information-circle-outline" size={15} color={colors.cocoaFaint} />
          <Muted style={styles.metaText}>
            We attach your handle, {platformName()}, and app version {appVersion()} so we can
            reproduce it. Nothing else is sent.
          </Muted>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Tab({
  label,
  hint,
  active,
  onPress,
  testID,
}: {
  label: string;
  hint: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabLabel, active && { color: colors.amberDark }]}>{label}</Text>
      <Text style={styles.tabHint}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { paddingHorizontal: spacing.lg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.lg,
  },
  cancel: { fontFamily: fonts.bold, color: colors.cocoaSoft, fontSize: 15, width: 50 },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  tab: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tabActive: { borderColor: colors.amber, backgroundColor: colors.creamDark },
  tabLabel: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.cocoa },
  tabHint: { fontFamily: fonts.semi, fontSize: 11.5, color: colors.cocoaFaint, marginTop: 2 },
  label: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  textarea: { minHeight: 140, textAlignVertical: 'top', marginBottom: spacing.lg },
  error: { fontFamily: fonts.semi, fontSize: 13, color: colors.danger, marginBottom: spacing.md },
  meta: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignItems: 'flex-start' },
  metaText: { flex: 1, fontSize: 12 },
  doneRoot: { alignItems: 'center', paddingHorizontal: spacing.lg },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  doneTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.cocoa, marginBottom: spacing.sm },
});
