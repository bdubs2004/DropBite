import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Button, Muted } from '../components/ui';
import { postUrl } from '../lib/links';
import { sharePost } from '../lib/share';
import { getDataService } from '../services';
import { colors, fonts, radius, spacing } from '../theme';
import { Post, User } from '../types';

/**
 * Send a post to people inside NiblGo, or share it out of the app.
 *
 * External sharing hands over a deep link (see src/lib/links.ts) so the
 * recipient lands on the post rather than the app's front door.
 */
export function ShareSheetScreen({ navigation, route }: any) {
  const { postId } = route.params as { postId: string };
  const svc = getDataService();
  const insets = useSafeAreaInsets();

  const [post, setPost] = useState<Post | null>(null);
  const [people, setPeople] = useState<User[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [externalNote, setExternalNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Only people you follow: sending a post opens a DM thread, and DMs are
    // opt-in, so listing anyone else would just fail at send time.
    const me = await svc.getCurrentUser();
    const [p, list] = await Promise.all([
      svc.getPost(postId),
      me ? svc.getFollowingUsers(me.id) : Promise.resolve([]),
    ]);
    setPost(p);
    setPeople(list);
    setLoading(false);
  }, [svc, postId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sendInternally = async () => {
    if (selected.size === 0 || sending) return;
    setSending(true);
    try {
      await svc.sharePostToUsers(postId, [...selected]);
      await svc.recordShare(postId);
      setSent(true);
      setTimeout(() => navigation.goBack(), 900);
    } catch (e: any) {
      setExternalNote(e?.message ?? 'Could not send that post.');
    } finally {
      setSending(false);
    }
  };

  const shareExternally = async () => {
    if (!post) return;
    const result = await sharePost(post, postUrl(postId));
    if (result === 'failed') {
      setExternalNote('Could not open the share sheet.');
      return;
    }
    await svc.recordShare(postId);
    setExternalNote(result === 'copied' ? 'Link copied to clipboard.' : null);
    if (result === 'shared') navigation.goBack();
  };

  if (sent) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <View style={styles.tick}>
          <Ionicons name="checkmark" size={32} color={colors.white} />
        </View>
        <Text style={styles.sentText}>Sent</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Send</Text>
        <View style={{ width: 56 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <>
          <FlatList
            testID="share-people"
            data={people}
            keyExtractor={(u) => u.id}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}
            ListHeaderComponent={
              <Muted style={{ marginBottom: spacing.sm }}>Send to</Muted>
            }
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return (
                <Pressable
                  testID={`share-to-${item.id}`}
                  onPress={() => toggle(item.id)}
                  style={[styles.person, on && styles.personOn]}
                >
                  <Avatar user={item} size={40} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.personName}>{item.display_name}</Text>
                    <Muted>@{item.handle}</Muted>
                  </View>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? colors.amberDark : colors.cocoaFaint}
                  />
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Muted>
                Follow someone to send them a post. You can still share it out of the app below.
              </Muted>
            }
          />

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <Button
              testID="share-send"
              title={
                sending
                  ? 'Sending'
                  : selected.size > 0
                    ? `Send to ${selected.size}`
                    : 'Select someone to send to'
              }
              onPress={sendInternally}
              disabled={selected.size === 0 || sending}
              loading={sending}
            />

            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.line} />
            </View>

            <Pressable testID="share-external" onPress={shareExternally} style={styles.externalBtn}>
              <Ionicons name="share-outline" size={19} color={colors.amberDark} />
              <Text style={styles.externalText}>
                {Platform.OS === 'web' ? 'Copy link' : 'Share outside NiblGo'}
              </Text>
            </Pressable>
            {externalNote ? (
              <Text testID="share-note" style={styles.note}>
                {externalNote}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  center: { alignItems: 'center', justifyContent: 'center' },
  tick: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentText: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.cocoa,
    marginTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  cancel: { fontFamily: fonts.bold, color: colors.cocoaSoft, fontSize: 15, width: 56 },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  personOn: { borderColor: colors.amber },
  personName: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.white,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.md,
  },
  line: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { fontFamily: fonts.bold, fontSize: 12, color: colors.cocoaFaint },
  externalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
    paddingVertical: 13,
  },
  externalText: { fontFamily: fonts.bold, fontSize: 15, color: colors.amberDark },
  note: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.cocoaSoft,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
