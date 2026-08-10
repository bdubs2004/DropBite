import React from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoLockup } from '../components/Logo';
import { PostCard } from '../components/PostCard';
import { Muted } from '../components/ui';
import { usePostActions } from '../lib/usePostActions';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';

export function FeedScreen({ navigation }: any) {
  const { feed, feedLoading, refreshFeed, streak, user } = useApp();
  const insets = useSafeAreaInsets();
  const { like, comment, share, repost, save, remove } = usePostActions(navigation, refreshFeed);

  const openProfile = (userId: string) => navigation.navigate('UserProfile', { userId });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <LogoLockup height={30} />
        <View style={styles.streakPill}>
          <Ionicons name="flame" size={15} color={colors.amber} />
          <Text style={styles.streakText}>{streak?.current_streak ?? 0}</Text>
        </View>
      </View>

      <FlatList
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
