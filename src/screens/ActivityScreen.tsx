import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useZooming } from '../components/PinchZoom';
import { PostCard } from '../components/PostCard';
import { PostThumb } from '../components/PostThumb';
import { Muted } from '../components/ui';
import { openPostFeed } from '../lib/postFeed';
import { usePostActions } from '../lib/usePostActions';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { Post } from '../types';

export type ActivityTab = 'liked' | 'saved' | 'commented';
type Layout = 'grid' | 'list';

const GRID_COLUMNS = 3;
const GRID_GAP = 2;
/** Remembers the viewer's grid/list preference across visits. */
const LAYOUT_KEY = 'niblgo.activityLayout';

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
  // Hold the list still while a photo in it is being pinched.
  const zooming = useZooming();

  const [tab, setTab] = useState<ActivityTab>(route.params?.tab ?? 'liked');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  // Grid (Instagram-style) or the richer list. Grid by default — it's what the
  // save area is really for: scanning a wall of photos — but the last choice is
  // remembered across visits.
  const [layout, setLayoutState] = useState<Layout>('grid');

  useEffect(() => {
    AsyncStorage.getItem(LAYOUT_KEY)
      .then((v) => {
        if (v === 'grid' || v === 'list') setLayoutState(v);
      })
      .catch(() => {});
  }, []);

  const setLayout = (l: Layout) => {
    setLayoutState(l);
    AsyncStorage.setItem(LAYOUT_KEY, l).catch(() => {});
  };

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

  const { like, comment, share, repost, save, remove, report, addToCollection } = usePostActions(
    navigation,
    load,
  );
  const active = TABS.find((t) => t.key === tab)!;

  // Pad the last grid row so a lone item stays a third-width, not full-width.
  const gridData: (Post | null)[] = (() => {
    const remainder = posts.length % GRID_COLUMNS;
    if (remainder === 0) return posts;
    return [...posts, ...Array(GRID_COLUMNS - remainder).fill(null)];
  })();

  const emptyState = (
    <View style={styles.empty}>
      <Ionicons name={active.icon} size={40} color={colors.cocoaFaint} />
      <Muted style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>{active.empty}</Muted>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Your activity</Text>
        <View style={styles.layoutToggle}>
          <Pressable
            testID="layout-grid"
            onPress={() => setLayout('grid')}
            hitSlop={6}
            style={[styles.layoutBtn, layout === 'grid' && styles.layoutBtnActive]}
          >
            <Ionicons
              name="grid"
              size={16}
              color={layout === 'grid' ? colors.amberDark : colors.cocoaFaint}
            />
          </Pressable>
          <Pressable
            testID="layout-list"
            onPress={() => setLayout('list')}
            hitSlop={6}
            style={[styles.layoutBtn, layout === 'list' && styles.layoutBtnActive]}
          >
            <Ionicons
              name="list"
              size={18}
              color={layout === 'list' ? colors.amberDark : colors.cocoaFaint}
            />
          </Pressable>
        </View>
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
      ) : layout === 'grid' ? (
        <FlatList
          // key forces a remount when switching columns count.
          key="grid"
          testID="activity-grid"
          data={gridData}
          keyExtractor={(p, i) => p?.id ?? `spacer-${i}`}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP, paddingTop: spacing.md, paddingBottom: 120 }}
          renderItem={({ item }) =>
            item ? (
              <PostThumb
                post={item}
                onPress={() => openPostFeed(navigation, posts, item.id, active.label)}
                onLongPress={() => navigation.navigate('PostPeek', { postId: item.id })}
                style={{ flex: 1 }}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )
          }
          ListEmptyComponent={emptyState}
        />
      ) : (
        <FlatList
          key="list"
          testID="activity-list"
          scrollEnabled={!zooming}
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
              onAddToCollection={addToCollection}
              isMine={item.user_id === user?.id}
            />
          )}
          ListEmptyComponent={emptyState}
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
  layoutToggle: {
    flexDirection: 'row',
    gap: 2,
    backgroundColor: colors.creamDark,
    borderRadius: radius.pill,
    padding: 3,
    width: 60,
    justifyContent: 'flex-end',
  },
  layoutBtn: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layoutBtnActive: { backgroundColor: colors.white, ...(shadowSoft as object) },
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
