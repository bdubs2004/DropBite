import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoLockup } from '../components/Logo';
import { PostCard } from '../components/PostCard';
import { Muted } from '../components/ui';
import { usePostActions } from '../lib/usePostActions';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';

export function FeedScreen({ navigation }: any) {
  const { feed, feedLoading, refreshFeed, streak, user } = useApp();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const [unread, setUnread] = useState(0);

  // Refresh the badge whenever the feed comes back into view, so reading a
  // thread clears it without a manual reload.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      svc.getUnreadCount().then((n) => alive && setUnread(n));
      return () => {
        alive = false;
      };
    }, [svc]),
  );
  const { like, comment, share, repost, save, remove, report } = usePostActions(navigation, refreshFeed);

  const listRef = useRef<FlatList<any>>(null);

  // Tapping Home while already on Home jumps to the top and pulls fresh posts,
  // the way Instagram behaves. The event comes from the custom TabBar in
  // App.tsx, which emits `tabPress` itself.
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      refreshFeed();
    });
    return unsub;
  }, [navigation, refreshFeed]);

  const openProfile = (userId: string) => navigation.navigate('UserProfile', { userId });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <LogoLockup height={30} />
        <View style={styles.headerRight}>
        <Pressable
          testID="streak-pill"
          onPress={() => navigation.navigate('Leaderboard')}
          style={({ pressed }) => [styles.streakPill, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Streak leaderboard"
        >
          <Ionicons name="flame" size={15} color={colors.amber} />
          <Text style={styles.streakText}>{streak?.current_streak ?? 0}</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.cocoaFaint} />
        </Pressable>
        <Pressable
          testID="inbox-pill"
          onPress={() => navigation.navigate('Inbox')}
          style={({ pressed }) => [styles.streakPill, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Messages"
        >
          <Ionicons name="paper-plane" size={15} color={colors.amber} />
          {unread > 0 ? (
            <View testID="inbox-badge" style={styles.unreadDot}>
              <Text style={styles.unreadText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </Pressable>
        </View>
      </View>

      <FlatList
        ref={listRef}
        testID="feed-list"
        data={feed}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onToggleLike={like}
            onComment={comment}
            onShare={share}
            onRepost={repost}
            onToggleSave={save}
            onPressUser={openProfile}
            onDelete={remove}
            onReport={report}
            isMine={item.user_id === user?.id}
          />
        )}
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={feedLoading}
            onRefresh={refreshFeed}
            tintColor={colors.amber}
            colors={[colors.amber]}
          />
        }
        ListEmptyComponent={
          feedLoading ? null : (
            <View style={styles.empty}>
              <Ionicons name="restaurant-outline" size={44} color={colors.cocoaFaint} />
              <Text style={styles.emptyTitle}>Nothing on the table yet</Text>
              <Muted style={{ textAlign: 'center' }}>
                Follow people in the Discover tab, or share your first meal with the + button.
              </Muted>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unreadDot: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    fontFamily: fonts.bold,
    fontSize: 10.5,
    color: colors.white,
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
  },
  streakText: {
    fontFamily: fonts.display,
    fontSize: 14,
    color: colors.cocoa,
  },
  empty: {
    alignItems: 'center',
    padding: spacing.xxl,
    marginTop: 60,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.cocoa,
    marginVertical: spacing.md,
  },
});
