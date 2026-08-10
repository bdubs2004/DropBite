import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostCard } from '../components/PostCard';
import { Muted } from '../components/ui';
import { usePostActions } from '../lib/usePostActions';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { Post } from '../types';

export type ActivityTab = 'liked' | 'saved' | 'commented';

const TABS: { key: ActivityTab; label: string; icon: any; empty: string }[] = [
  {
    key: 'liked',
    label: 'Liked',
    icon: 'heart-outline',
    empty: 'Posts you like show up here.',
  },
  {
    key: 'saved',
    label: 'Saved',
    icon: 'bookmark-outline',
    empty: 'Tap the bookmark on any post to save it here for later.',
  },
  {
    key: 'commented',
    label: 'Comments',
    icon: 'chatbubble-outline',
    empty: 'Posts you comment on show up here.',
  },
];

/**
 * Your activity: everything you've liked, saved, or commented on.
 *
 * All three lists are private to you — they're built from your own rows, and
 * in production RLS keeps saved_posts owner-only.
 */
export function ActivityScreen({ navigation, route }: any) {
  const svc = getDataService();
  const { user } = useApp();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<ActivityTab>(route.params?.tab ?? 'liked');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const next =
      tab === 'liked'
        ? await svc.getLikedPosts()
        : tab === 'saved'
          ? await svc.getSavedPosts()
          : await svc.getCommentedPosts();
    setPosts(next);
    setLoading(false);
  }, [svc, tab]);

  // On focus so unliking or unsaving elsewhere is reflected when you come back.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const { like, comment, share, repost, save, remove, report } = usePostActions(
    navigation,
    load,
  );
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Your activity</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            testID={`activity-tab-${t.key}`}
            onPress={() => setTab(t.key)}
            style={[styles.tab, tab === t.key && styles.tabActive]}
          >
            <Ionicons
              name={t.icon}
              size={15}
              color={tab === t.key ? colors.amberDark : colors.cocoaSoft}
            />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          testID="activity-list"
          data={posts}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: 120 }}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onToggleLike={like}
              onComment={comment}
              onShare={share}
              onRepost={repost}
              onToggleSave={save}
              onPressUser={(uid) => navigation.navigate('UserProfile', { userId: uid })}
              onDelete={remove}
              onReport={report}
              isMine={item.user_id === user?.id}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name={active.icon} size={40} color={colors.cocoaFaint} />
              <Muted style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
                {active.empty}
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
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 60, marginLeft: -4 },
  back: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.creamDark,
    borderRadius: radius.pill,
    padding: 4,
    marginHorizontal: spacing.lg,
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  tabActive: { backgroundColor: colors.white, ...(shadowSoft as object) },
  tabText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoaSoft },
  tabTextActive: { color: colors.amberDark },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 80 },
});
