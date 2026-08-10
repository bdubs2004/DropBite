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
import { getDataService } from '../services';
import { colors, fonts, radius, spacing } from '../theme';
import { ReportReason } from '../types';

/**
 * Report a post.
 *
 * Reasons are stored as stable keys (see ReportReason) so the copy here can be
 * reworded without invalidating past moderation records. The reporter is never
 * shown the outcome and the reported user is never told who filed — see
 * MODERATION.md for how the queue is worked.
 */
const REASONS: { key: ReportReason; label: string; hint: string }[] = [
  { key: 'spam', label: 'Spam or scam', hint: 'Fake offers, bots, repetitive promotion' },
  { key: 'harassment', label: 'Harassment or hate', hint: 'Bullying, threats, slurs' },
  { key: 'sexual', label: 'Nudity or sexual content', hint: 'Explicit imagery or text' },
  { key: 'violence', label: 'Violence or dangerous acts', hint: 'Graphic or threatening content' },
  { key: 'self_harm', label: 'Self-harm or eating disorder', hint: 'Content promoting harm' },
  { key: 'false_info', label: 'False information', hint: 'Misleading health or safety claims' },
  {
    key: 'intellectual_property',
    label: 'Intellectual property',
    hint: "Someone else's photo or recipe used without permission",
  },
  { key: 'other', label: 'Something else', hint: 'Tell us what is wrong' },
];

export function ReportScreen({ navigation, route }: any) {
  const { postId } = route.params as { postId: string };
  const svc = getDataService();
  const insets = useSafeAreaInsets();

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Something else" is meaningless without context, so require a sentence.
  const detailRequired = reason === 'other';
  const canSubmit =
    reason !== null && (!detailRequired || detail.trim().length >= 3) && !submitting;

  const submit = async () => {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await svc.reportPost(postId, reason, detail);
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not send that report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <View style={[styles.root, styles.doneRoot, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.doneIcon}>
          <Ionicons name="checkmark" size={34} color={colors.white} />
        </View>
        <Text style={styles.doneTitle}>Thanks for telling us</Text>
        <Muted style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
          Our team will review this post. We do not tell the person who reported
          them, and we will not share the outcome of the review.
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
        <View style={styles.headerRow}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Report post</Text>
          <View style={{ width: 50 }} />
        </View>

        <Muted style={{ marginBottom: spacing.lg }}>
          Why are you reporting this? Reports are confidential.
        </Muted>

        {REASONS.map((r) => {
          const active = reason === r.key;
          return (
            <Pressable
              key={r.key}
              testID={`report-reason-${r.key}`}
              onPress={() => setReason(r.key)}
              style={[styles.reasonRow, active && styles.reasonRowActive]}
            >
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={active ? colors.amberDark : colors.cocoaFaint}
              />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[styles.reasonLabel, active && { color: colors.amberDark }]}>
                  {r.label}
                </Text>
                <Muted>{r.hint}</Muted>
              </View>
            </Pressable>
          );
        })}

        <Text style={styles.detailLabel}>
          {detailRequired ? 'What is wrong?' : 'Anything else? (optional)'}
        </Text>
        <Input
          testID="report-detail"
          placeholder="Add any detail that helps us review this"
          value={detail}
          onChangeText={setDetail}
          multiline
          maxLength={1000}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title={submitting ? 'Sending' : 'Submit report'}
          testID="report-submit"
          onPress={submit}
          disabled={!canSubmit}
          loading={submitting}
        />
        <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>
          If someone is in immediate danger, contact your local emergency
          services. Reporting here does not alert authorities.
        </Muted>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  scroll: {
    padding: spacing.lg,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  cancel: {
    fontFamily: fonts.bold,
    color: colors.cocoaSoft,
    fontSize: 15,
    width: 50,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.cocoa,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  reasonRowActive: {
    borderColor: colors.amber,
  },
  reasonLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.cocoa,
  },
  detailLabel: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  error: {
    fontFamily: fonts.bold,
    color: colors.danger,
    fontSize: 13.5,
    marginBottom: spacing.sm,
  },
  doneRoot: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  doneTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.cocoa,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
});
