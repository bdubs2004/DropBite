import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { PostThumb } from '../components/PostThumb';
import { Muted } from '../components/ui';
import { relativeTime } from '../lib/time';
import { getDataService } from '../services';
import { colors, fonts, radius, spacing } from '../theme';
import { AppNotification, NotificationType } from '../types';

/** Icon and verb for each kind of interaction. */
const KIND: Record<NotificationType, { icon: any; color: string; verb: string }> = {
  like: { icon: 'heart', color: colors.danger, verb: 'liked your post' },
  comment: { icon: 'chatbubble', color: colors.amberDark, verb: 'commented on your post' },
  repost: { icon: 'repeat', color: colors.amberDark, verb: 'reposted your post' },
  share: { icon: 'paper-plane', color: colors.amberDark, verb: 'shared your post' },
  tag: { icon: 'pricetag', color: colors.amberDark, verb: 'tagged you in a post' },
};

/**
 * Everything that happened to your posts, newest first.
 *
 * Rows are written by database triggers, so this list is a read-only view of
 * what actually happened — the app never creates a notification itself. Opening
 * the screen marks them read, but the unread highlight stays for this render so
 * you can still see what was new.
 *
 * "Clear" doesn't wipe everything at once: it switches to picking, with a
 * circle on every row. Tick the ones to go (or Select all) and hit the trash.
 */
export function NotificationsScreen({ navigation }: any) {
  const svc = getDataService();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await svc.getNotifications();
    setItems(list);
    setLoading(false);
    // Read them after rendering, so the "new" highlight survives this pass.
    await svc.markNotificationsRead();
  }, [svc]);

  useEffect(() => {
    load();
  }, [load]);

  const pullRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  // Picking mode: a circle on each row, Select all, and a trash bar.
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const allChosen = items.length > 0 && chosen.size === items.length;

  const startSelecting = () => {
    setChosen(new Set());
    setSelecting(true);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setChosen(new Set());
  };
  const flip = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setChosen(allChosen ? new Set() : new Set(items.map((n) => n.id)));

  const deleteChosen = async () => {
    if (!chosen.size || deleting) return;
    const ids = [...chosen];
    setDeleting(true);
    // Gone from the list straight away; put back if the delete fails.
    const before = items;
    setItems((prev) => prev.filter((n) => !chosen.has(n.id)));
    stopSelecting();
    try {
      await svc.deleteNotifications(ids);
    } catch {
      setItems(before);
    } finally {
      setDeleting(false);
    }
  };

  const open = (n: AppNotification) => {
    if (!n.post_id) return;
    if (n.type === 'comment') navigation.navigate('Comments', { postId: n.post_id });
    else navigation.navigate('PostDetail', { postId: n.post_id });
  };

  // Tapping the avatar opens the person; tapping the body opens the post.
  const openProfile = (userId?: string) => {
    if (userId) navigation.navigate('UserProfile', { userId });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {selecting ? (
          <Pressable
            testID="notifications-cancel"
            onPress={stopSelecting}
            hitSlop={10}
            style={styles.backBtn}
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
            <Text style={styles.back}>Back</Text>
          </Pressable>
        )}
        <Text testID="notifications-title" style={styles.title}>
          {selecting ? (chosen.size ? `${chosen.size} selected` : 'Select items') : 'Activity'}
        </Text>
        {selecting ? (
          <Pressable testID="notifications-select-all" onPress={toggleAll} hitSlop={10}>
            <Text style={styles.headerAction}>{allChosen ? 'Deselect all' : 'Select all'}</Text>
          </Pressable>
        ) : items.length > 0 ? (
          <Pressable testID="notifications-clear" onPress={startSelecting} hitSlop={10}>
            <Text style={styles.headerAction}>Clear</Text>
          </Pressable>
        ) : (
          <View style={{ width: 66 }} />
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          testID="notifications-list"
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullRefresh}
              tintColor={colors.amber}
              colors={[colors.amber]}
            />
          }
          renderItem={({ item }) => {
            const kind = KIND[item.type];
            const on = chosen.has(item.id);
            return (
              <View
                testID={`notification-${item.id}`}
                style={[styles.row, !item.read_at && styles.rowUnread, on && styles.rowChosen]}
              >
                {selecting ? (
                  <Ionicons
                    testID={`notification-check-${item.id}`}
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={on ? colors.amberDark : colors.cocoaFaint}
                    style={styles.check}
                  />
                ) : null}
                {/* Avatar → the person's profile. */}
                <Pressable
                  testID={`notification-actor-${item.id}`}
                  onPress={() => openProfile(item.actor?.id)}
                  hitSlop={6}
                >
                  <Avatar user={item.actor} size={44} />
                  <View style={[styles.kindBadge, { backgroundColor: kind.color }]}>
                    <Ionicons name={kind.icon} size={11} color={colors.white} />
                  </View>
                </Pressable>

                {/* Body (text + thumbnail) → the post it happened on. */}
                <Pressable
                  testID={`notification-body-${item.id}`}
                  onPress={() => open(item)}
                  style={styles.body}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.text}>
                      <Text style={styles.name}>{item.actor?.display_name ?? 'Someone'}</Text>{' '}
                      {kind.verb}
                      {item.type === 'comment' && item.comment_text
                        ? `: ${item.comment_text}`
                        : ''}
                    </Text>
                    <Muted style={styles.time}>{relativeTime(item.created_at)}</Muted>
                  </View>

                  {/* PostThumb, not a raw Image: demo posts have no real photo
                      and fall back to the same emoji tile used everywhere else. */}
                  {/* The picture always opens the post itself, even on a
                      comment (where the words open the comments). */}
                  {item.post ? (
                    <PostThumb
                      post={item.post}
                      radius={8}
                      style={styles.thumb}
                      onPress={() =>
                        item.post_id && navigation.navigate('PostDetail', { postId: item.post_id })
                      }
                    />
                  ) : null}
                </Pressable>

                {/* While picking, the whole row is one big tick target (so a
                    tap never wanders off to a profile or post). */}
                {selecting ? (
                  <Pressable
                    testID={`notification-select-${item.id}`}
                    onPress={() => flip(item.id)}
                    style={StyleSheet.absoluteFill}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  />
                ) : null}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="notifications-outline" size={40} color={colors.cocoaFaint} />
              <Text style={styles.emptyTitle}>Nothing yet</Text>
              <Muted style={{ textAlign: 'center' }}>
                When someone likes, comments on, or shares one of your posts, it shows up here
              </Muted>
            </View>
          }
        />
      )}

      {selecting ? (
        <View style={[styles.trashBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable
            testID="notifications-delete"
            onPress={deleteChosen}
            disabled={!chosen.size || deleting}
            style={[styles.trashBtn, (!chosen.size || deleting) && { opacity: 0.4 }]}
            accessibilityLabel="Delete selected"
          >
            <Ionicons name="trash-outline" size={19} color={colors.white} />
            <Text style={styles.trashText}>
              {chosen.size ? `Delete (${chosen.size})` : 'Delete'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 66, marginLeft: -4 },
  back: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  headerAction: {
    fontFamily: fonts.bold,
    color: colors.amberDark,
    fontSize: 14,
    minWidth: 66,
    textAlign: 'right',
  },
  cancel: { fontFamily: fonts.bold, color: colors.cocoaSoft, fontSize: 15 },
  check: { marginRight: spacing.sm },
  rowChosen: { borderColor: colors.amber },
  trashBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  trashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    paddingVertical: 13,
  },
  trashText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    // Always there (clear) so ticking a row doesn't nudge it by a pixel.
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  // Unread rows get a warm wash rather than a dot: easier to scan a whole list.
  rowUnread: { backgroundColor: colors.creamDark },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.md,
  },
  kindBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 19,
    height: 19,
    borderRadius: 9.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },
  text: { fontFamily: fonts.semi, fontSize: 14.5, lineHeight: 20, color: colors.cocoa },
  name: { fontFamily: fonts.bold },
  time: { fontSize: 11.5, marginTop: 2 },
  thumb: { width: 46, height: 46, marginLeft: spacing.md },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 70, paddingHorizontal: spacing.xl },
  emptyTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.cocoa },
});
