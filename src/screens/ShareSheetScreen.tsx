import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Button, Muted } from '../components/ui';
import { conversationDisplayName } from '../lib/conversationName';
import { postUrl } from '../lib/links';
import { sharePost } from '../lib/share';
import { getDataService } from '../services';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { Conversation, Post, User } from '../types';

type Row = { kind: 'group'; conv: Conversation } | { kind: 'person'; user: User };

/**
 * Send a post (or a profile) to your group chats and people inside NiblGo,
 * or share a post out of the app. Group chats you're already in are listed
 * first; picking one drops it straight into that thread.
 *
 * External sharing hands over a deep link (see src/lib/links.ts) so the
 * recipient lands on the post rather than the app's front door. Profiles are
 * in-app only for now: the website doesn't have a profile page to land on.
 */
export function ShareSheetScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const { postId, userId: profileId } = route.params as { postId?: string; userId?: string };
  const isProfile = !!profileId && !postId;
  const svc = getDataService();
  const insets = useSafeAreaInsets();
  // A full-screen page now (see SLIDE_UP in App.tsx), so it clears the status
  // bar itself.
  const topPad = insets.top;

  const [post, setPost] = useState<Post | null>(null);
  const [people, setPeople] = useState<User[]>([]);
  const [groups, setGroups] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [asGroup, setAsGroup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [externalNote, setExternalNote] = useState<string | null>(null);

  // Making a NEW group chat from people only makes sense with two or more.
  const canGroup = selected.size >= 2;
  const sendingToGroup = canGroup && asGroup;
  const total = selected.size + selectedGroups.size;

  const load = useCallback(async () => {
    // Only people you follow: sending a post opens a DM thread, and DMs are
    // opt-in, so listing anyone else would just fail at send time.
    const me = await svc.getCurrentUser();
    const [p, list, convs] = await Promise.all([
      postId ? svc.getPost(postId) : Promise.resolve(null),
      me ? svc.getFollowingUsers(me.id) : Promise.resolve([] as User[]),
      svc.getConversations().catch(() => [] as Conversation[]),
    ]);
    setPost(p);
    // No point sending someone their own profile.
    setPeople(isProfile ? list.filter((u) => u.id !== profileId) : list);
    setGroups(convs.filter((c) => c.is_group));
    setLoading(false);
  }, [svc, postId, profileId, isProfile]);

  useEffect(() => {
    load();
  }, [load]);

  const flip = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sendInternally = async () => {
    if (total === 0 || sending) return;
    setSending(true);
    try {
      if (isProfile) {
        if (selected.size) {
          if (sendingToGroup) await svc.shareProfileToGroup(profileId!, [...selected]);
          else await svc.shareProfileToUsers(profileId!, [...selected]);
        }
        for (const convId of selectedGroups) {
          await svc.sendMessage(convId, { sharedUserId: profileId });
        }
      } else {
        if (selected.size) {
          if (sendingToGroup) await svc.sharePostToGroup(postId!, [...selected]);
          else await svc.sharePostToUsers(postId!, [...selected]);
        }
        for (const convId of selectedGroups) {
          await svc.sendMessage(convId, { sharedPostId: postId });
        }
        await svc.recordShare(postId!);
      }
      setSent(true);
      // Just a quick flash of confirmation, then out of the way.
      setTimeout(() => navigation.goBack(), 300);
    } catch (e: any) {
      setExternalNote(e?.message ?? 'Could not send that post');
    } finally {
      setSending(false);
    }
  };

  const shareExternally = async () => {
    if (!post || !postId) return;
    const result = await sharePost(post, postUrl(postId));
    if (result === 'failed') {
      setExternalNote('Could not open the share sheet');
      return;
    }
    await svc.recordShare(postId);
    setExternalNote(result === 'copied' ? 'Link copied to clipboard' : null);
    if (result === 'shared') navigation.goBack();
  };

  if (sent) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: topPad }]}>
        <View style={styles.tick}>
          <Ionicons name="checkmark" size={32} color={colors.white} />
        </View>
        <Text style={styles.sentText}>Sent</Text>
      </View>
    );
  }

  const rows: Row[] = [
    ...groups.map((conv) => ({ kind: 'group' as const, conv })),
    ...people.map((user) => ({ kind: 'person' as const, user })),
  ];

  const check = (on: boolean) => (
    <Ionicons
      name={on ? 'checkmark-circle' : 'ellipse-outline'}
      size={22}
      color={on ? colors.amberDark : colors.cocoaFaint}
    />
  );

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>{isProfile ? 'Share profile' : 'Send'}</Text>
        <View style={{ width: 56 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <>
          <FlatList
            testID="share-people"
            data={rows}
            keyExtractor={(r) => (r.kind === 'group' ? `g-${r.conv.id}` : `p-${r.user.id}`)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              if (item.kind === 'group') {
                const on = selectedGroups.has(item.conv.id);
                return (
                  <Pressable
                    testID={`share-to-group-${item.conv.id}`}
                    onPress={() => flip(setSelectedGroups, item.conv.id)}
                    style={[styles.row, on && styles.rowOn]}
                  >
                    <View style={styles.groupAvatar}>
                      <Ionicons name="people" size={20} color={colors.amberDark} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.name} numberOfLines={1}>
                        {conversationDisplayName(item.conv)}
                      </Text>
                      <Muted>{item.conv.others.length + 1} members</Muted>
                    </View>
                    {check(on)}
                  </Pressable>
                );
              }
              const on = selected.has(item.user.id);
              return (
                <Pressable
                  testID={`share-to-${item.user.id}`}
                  onPress={() => flip(setSelected, item.user.id)}
                  style={[styles.row, on && styles.rowOn]}
                >
                  <Avatar user={item.user} size={40} />
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.user.display_name}
                    </Text>
                    <Muted>@{item.user.handle}</Muted>
                  </View>
                  {check(on)}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
                {isProfile
                  ? 'Follow someone to send them this profile'
                  : 'Follow someone to send them a post, or share it out of the app below'}
              </Muted>
            }
          />

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            {canGroup ? (
              <Pressable
                testID="share-group-toggle"
                onPress={() => setAsGroup((g) => !g)}
                style={[styles.groupToggle, asGroup && styles.groupToggleOn]}
              >
                <Ionicons
                  name={asGroup ? 'people' : 'people-outline'}
                  size={20}
                  color={asGroup ? colors.amberDark : colors.cocoaSoft}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupToggleLabel}>Start a new group chat</Text>
                  <Text style={styles.groupToggleHint}>
                    {asGroup
                      ? 'One new thread with the people you picked'
                      : 'Off: sends each person their own DM'}
                  </Text>
                </View>
                {check(asGroup)}
              </Pressable>
            ) : null}

            <Button
              testID="share-send"
              title={sending ? 'Sending' : total === 0 ? 'Pick who to send to' : `Send (${total})`}
              onPress={sendInternally}
              disabled={total === 0 || sending}
              loading={sending}
            />

            {isProfile ? null : (
              <Pressable testID="share-external" onPress={shareExternally} style={styles.externalBtn}>
                <Ionicons name="share-outline" size={18} color={colors.amberDark} />
                <Text style={styles.externalText}>
                  {Platform.OS === 'web' ? 'Copy link' : 'Share outside NiblGo'}
                </Text>
              </Pressable>
            )}
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

const useStyles = makeStyles((colors) => ({
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
  sentText: { fontFamily: fonts.display, fontSize: 20, color: colors.cocoa, marginTop: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  cancel: { fontFamily: fonts.bold, color: colors.cocoaSoft, fontSize: 15, width: 56 },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  rowOn: { borderColor: colors.amber },
  rowText: { flex: 1, marginLeft: spacing.md },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  groupAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  groupToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  groupToggleOn: { borderColor: colors.amber, backgroundColor: colors.cream },
  groupToggleLabel: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.cocoa },
  groupToggleHint: { fontFamily: fonts.semi, fontSize: 12, color: colors.cocoaFaint, marginTop: 1 },
  externalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
  },
  externalText: { fontFamily: fonts.bold, fontSize: 15, color: colors.amberDark },
  note: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.cocoaSoft,
    textAlign: 'center',
  },
}));
