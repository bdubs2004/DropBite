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
};

/**
 * Everything that happened to your posts, newest first.
 *
 * Rows are written by database triggers, so this list is a read-only view of
 * what actually happened — the app never creates a notification itself. Opening
 * the screen marks them read, but the unread highlight stays for this render so
 * you can still see what was new.
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

  const clearAll = async () => {
    setItems([]);
    await svc.clearNotifications();
  };

  const open = (n: AppNotification) => {
    if (!n.post_id) return;
    if (n.type === 'comment') navigation.navigate('Comments', { postId: n.post_id });
    else navigation.navigate('PostDetail', { postId: n.post_id });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Activity</Text>
        {items.length > 0 ? (
          <Pressable testID="notifications-clear" onPress={clearAll} hitSlop={10}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : (
          <View style={{ width: 46 }} />
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          testID="notifications-list"
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
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
            return (
              <Pressable
                testID={`notification-${item.id}`}
                onPress={() => open(item)}
                style={[styles.row, !item.read_at && styles.rowUnread]}
              >
                <View>
                  <Avatar user={item.actor} size={44} />
                  <View style={[styles.kindBadge, { backgroundColor: kind.color }]}>
                    <Ionicons name={kind.icon} size={11} color={colors.white} />
                  </View>
                </View>

                <View style={{ flex: 1, marginLeft: spacing.md }}>
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
                {item.post ? (
                  <PostThumb post={item.post} radius={8} style={styles.thumb} />
                ) : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="notifications-outline" size={40} color={colors.cocoaFaint} />
              <Text style={styles.emptyTitle}>Nothing yet</Text>
              <Muted style={{ textAlign: 'center' }}>
                When someone likes, comments on, or shares one of your posts, it shows up here.
              </Muted>
            </View>
          }
        />
      )}
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
  clear: { fontFamily: fonts.bold, color: colors.cocoaSoft, fontSize: 14, width: 46, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  // Unread rows get a warm wash rather than a dot: easier to scan a whole list.
  rowUnread: { backgroundColor: colors.creamDark },
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
