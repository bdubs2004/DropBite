import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { PostThumb } from '../components/PostThumb';
import { Button, Muted, ScreenTitle } from '../components/ui';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { DiscoverPerson, Post } from '../types';

type Tab = 'posts' | 'people';

const GRID_COLUMNS = 3;
const GRID_GAP = 2;

/**
 * Discover: browse everything on NiblGo, not just your feed.
 *
 * Two modes — a photo grid of recent posts (Instagram/TikTok explore) and a
 * list of people with a taste of what they cook. No search box here; Discover
 * is for browsing, the Search tab is for looking something up.
 */
export function DiscoverScreen({ navigation }: any) {
  const svc = getDataService();
  const { refreshFeed } = useApp();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [people, setPeople] = useState<DiscoverPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const gridRef = useRef<FlatList<Post | null>>(null);
  const peopleRef = useRef<FlatList<DiscoverPerson>>(null);

  const load = useCallback(async () => {
    // Load both tabs together so switching is instant.
    const [p, u] = await Promise.all([svc.getDiscoverPosts(), svc.getDiscoverPeople()]);
    setPosts(p);
    setPeople(u);
    setLoading(false);
  }, [svc]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
      gridRef.current?.scrollToOffset({ offset: 0, animated: true });
      peopleRef.current?.scrollToOffset({ offset: 0, animated: true });
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // Tapping Discover while already on Discover reloads the whole page, the
  // same way the Home tab behaves. The event comes from the custom TabBar.
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      refresh();
    });
    return unsub;
  }, [navigation, refresh]);

  const openPost = (post: Post) => navigation.navigate('PostDetail', { postId: post.id });

  /**
   * Pad the grid to a whole number of rows. Without this the last row's items
   * are flex:1 with nothing beside them, so a lone tile stretches the full
   * width instead of staying a third.
   */
  const gridData: (Post | null)[] = (() => {
    const remainder = posts.length % GRID_COLUMNS;
    if (remainder === 0) return posts;
    return [...posts, ...Array(GRID_COLUMNS - remainder).fill(null)];
  })();
  const openProfile = (userId: string) => navigation.navigate('UserProfile', { userId });

  const toggleFollow = async (person: DiscoverPerson) => {
    // Flip locally first so the button responds immediately, then persist.
    setPeople((prev) =>
      prev.map((p) =>
        p.user.id === person.user.id ? { ...p, is_following: !p.is_following } : p,
      ),
    );
    if (person.is_following) await svc.unfollow(person.user.id);
    else await svc.follow(person.user.id);
    refreshFeed();
  };

  const header = (
    <View style={styles.header}>
      <ScreenTitle>Discover</ScreenTitle>
      <Muted>
        {tab === 'posts' ? 'What everyone is eating right now.' : 'People worth following.'}
      </Muted>
      <View style={styles.tabs}>
        <TabButton label="Posts" active={tab === 'posts'} onPress={() => setTab('posts')} />
        <TabButton label="People" active={tab === 'people'} onPress={() => setTab('people')} />
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {tab === 'posts' ? (
        <FlatList
          ref={gridRef}
          testID="discover-grid"
          data={gridData}
          key="grid"
          keyExtractor={(p, i) => p?.id ?? `spacer-${i}`}
          numColumns={GRID_COLUMNS}
          ListHeaderComponent={header}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.amber} />
          }
          renderItem={({ item }) =>
            item ? (
              <PostThumb post={item} onPress={() => openPost(item)} style={{ flex: 1 }} />
            ) : (
              <View style={{ flex: 1 }} />
            )
          }
          ListEmptyComponent={
            <Muted style={styles.empty}>
              Nothing to discover yet. Once other people post, their meals show up here.
            </Muted>
          }
        />
      ) : (
        <FlatList
          ref={peopleRef}
          testID="discover-people"
          data={people}
          key="people"
          keyExtractor={(p) => p.user.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.amber} />
          }
          renderItem={({ item }) => (
            <PersonCard
              person={item}
              onOpenProfile={() => openProfile(item.user.id)}
              onOpenPost={openPost}
              onToggleFollow={() => toggleFollow(item)}
            />
          )}
          ListEmptyComponent={
            <Muted style={styles.empty}>No one to show yet. Invite your friends to join.</Muted>
          }
        />
      )}
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`discover-tab-${label.toLowerCase()}`}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** A mini profile: who they are, a follow button, and three recent meals. */
function PersonCard({
  person,
  onOpenProfile,
  onOpenPost,
  onToggleFollow,
}: {
  person: DiscoverPerson;
  onOpenProfile: () => void;
  onOpenPost: (post: Post) => void;
  onToggleFollow: () => void;
}) {
  const { user, posts, post_count, is_following } = person;
  return (
    <View style={styles.personCard}>
      <View style={styles.personTop}>
        <Pressable style={styles.personTap} onPress={onOpenProfile}>
          <Avatar user={user} size={52} />
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={styles.personName}>{user.display_name}</Text>
            <Muted>@{user.handle}</Muted>
            <Text style={styles.personMeta}>
              {post_count} {post_count === 1 ? 'meal' : 'meals'}
            </Text>
          </View>
        </Pressable>
        <Button
          testID={`follow-${user.id}`}
          title={is_following ? 'Following' : 'Follow'}
          variant={is_following ? 'secondary' : 'primary'}
          onPress={onToggleFollow}
          small
        />
      </View>

      {user.bio ? (
        <Text style={styles.personBio} numberOfLines={2}>
          {user.bio}
        </Text>
      ) : null}

      {posts.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {posts.map((p) => (
            <PostThumb
              key={p.id}
              post={p}
              onPress={() => onOpenPost(p)}
              radius={12}
              style={styles.stripThumb}
            />
          ))}
        </ScrollView>
      ) : (
        <Muted style={{ marginTop: spacing.md }}>No meals shared yet.</Muted>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.creamDark,
    borderRadius: radius.pill,
    padding: 4,
    marginTop: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.white,
    ...(shadowSoft as object),
  },
  tabText: {
    fontFamily: fonts.bold,
    fontSize: 14.5,
    color: colors.cocoaSoft,
  },
  tabTextActive: {
    color: colors.amberDark,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  personCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    ...(shadowSoft as object),
  },
  personTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  personTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  personName: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.cocoa,
  },
  personMeta: {
    fontFamily: fonts.semi,
    fontSize: 12,
    color: colors.amberDark,
    marginTop: 2,
  },
  personBio: {
    fontFamily: fonts.semi,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.cocoaSoft,
    marginTop: spacing.sm,
  },
  strip: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  stripThumb: {
    width: 104,
  },
});
