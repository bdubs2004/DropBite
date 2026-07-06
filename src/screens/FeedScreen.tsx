import React, { useCallback } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoLockup } from '../components/Logo';
import { PostCard } from '../components/PostCard';
import { Muted } from '../components/ui';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';
import { Post } from '../types';

export function FeedScreen({ navigation }: any) {
  const { feed, feedLoading, refreshFeed, streak } = useApp();
  const insets = useSafeAreaInsets();
  const svc = getDataService();

  const toggleLike = useCallback(
    async (post: Post) => {
      await svc.toggleReaction(post.id);
      refreshFeed();
    },
    [svc, refreshFeed],
  );

  const openProfile = (userId: string) => navigation.navigate('UserProfile', { userId });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <LogoLockup height={30} />
        <View style={styles.streakPill}>
          <Text style={styles.streakText}>🔥 {streak?.current_streak ?? 0}</Text>
        </View>
      </View>

      <FlatList
        data={feed}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard post={item} onToggleLike={toggleLike} onPressUser={openProfile} />
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
              <Text style={styles.emptyEmoji}>🍽️</Text>
              <Text style={styles.emptyTitle}>Nothing on the table yet</Text>
              <Muted style={{ textAlign: 'center' }}>
                Follow some friends in the Friends tab, or drop your first meal with the + button.
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
  streakPill: {
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
  },
  streakText: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.cocoa,
  },
  empty: {
    alignItems: 'center',
    padding: spacing.xxl,
    marginTop: 60,
  },
  emptyEmoji: {
    fontSize: 52,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.cocoa,
    marginBottom: spacing.sm,
  },
});
