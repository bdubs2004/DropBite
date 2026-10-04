import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { ActionSheet } from '../components/ActionSheet';
import { ActivityDrawer } from '../components/ActivityDrawer';
import { PostThumb } from '../components/PostThumb';
import { RenameGroupSheet } from '../components/RenameGroupSheet';
import { Button, Muted } from '../components/ui';
import { COLLECTION_NAME_MAX, collectionNameProblem } from '../lib/collectionName';
import { openPostFeed } from '../lib/postFeed';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { Collection, Post, Streak, User } from '../types';

/**
 * Shows either my own profile (tab) or another user's (pushed from feed).
 */
const GRID_COLUMNS = 3;
const GRID_GAP = 2;

export function ProfileScreen({ navigation, route }: any) {
  const { user: me, refreshFeed, hiddenIds } = useApp();
  const svc = getDataService();
  const insets = useSafeAreaInsets();

  const userId: string = route?.params?.userId ?? me?.id;
  const isMe = userId === me?.id;
  const listRef = useRef<FlatList<Post | null>>(null);

  const [otherProfile, setOtherProfile] = useState<User | null>(null);
  // For my own profile, read straight from live context so a saved bio /
  // name shows the moment Settings updates it.
  const profile = isMe ? me : otherProfile;
  const [posts, setPosts] = useState<Post[]>([]);
  const [reposts, setReposts] = useState<Post[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tab, setTab] = useState<'posts' | 'reposts' | 'collections'>('posts');
  const [naming, setNaming] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  const openList = (mode: 'followers' | 'following') => {
    navigation.navigate('UserList', {
      userId,
      mode,
      displayName: profile?.display_name ?? 'This user',
      isPrivate: Boolean(profile?.follows_private),
      isMe,
    });
  };

  const scrollToPosts = () => {
    if (posts.length) {
      listRef.current?.scrollToIndex({ index: 0, viewOffset: 8, animated: true });
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userPosts, userReposts, cols, s, c, followingIds] = await Promise.all([
        svc.getUserPosts(userId),
        svc.getReposts(userId),
        // Never let collections stop the profile loading (e.g. a database
        // that hasn't run migration 0022 yet).
        svc.getCollections(userId).catch(() => [] as Collection[]),
        svc.getStreak(userId),
        svc.getFollowCounts(userId),
        svc.getFollowingIds(),
      ]);
      setPosts(userPosts);
      setReposts(userReposts);
      setCollections(cols);
      setStreak(s);
      setCounts(c);
      setFollowing(followingIds.includes(userId));
      if (!isMe) {
        setBlocked(await svc.isBlocked(userId));
        const all = await svc.listUsers();
        setOtherProfile(all.find((u) => u.id === userId) ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [svc, userId, isMe, me]);

  // Reload whenever the screen regains focus so follow/unfollow done elsewhere
  // (Discover, another profile) is reflected in the counts.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Tapping the Profile tab while you're already on it jumps to the top and
  // refreshes, same as Home and Discover. (Only the tab version of this screen
  // gets the event; someone else's profile is a stack screen.)
  const collectionsRef = useRef<FlatList<any>>(null);
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      collectionsRef.current?.scrollToOffset({ offset: 0, animated: true });
      pullRefresh();
    });
    return unsub;
    // pullRefresh is recreated each render; the latest one is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, load]);

  const toggleFollow = async () => {
    if (following) await svc.unfollow(userId);
    else await svc.follow(userId);
    setFollowing(!following);
    load();
    refreshFeed();
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [otherMenuOpen, setOtherMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const pullRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const doBlock = async () => {
    await svc.blockUser(userId);
    setBlocked(true);
    load();
    refreshFeed();
  };

  /** Blocking is reversible but surprising, so confirm first. */
  const confirmBlock = () => {
    if (Platform.OS === 'web') {
      setConfirmingBlock(true);
      return;
    }
    Alert.alert(
      `Block @${profile?.handle ?? ''}?`,
      'You will not see their posts and they will not see yours. Any follow between you is removed, and neither of you can message the other.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: doBlock },
      ],
    );
  };

  /** Pad to whole rows so a lone final tile stays a third wide. */
  const source = tab === 'posts' ? posts : reposts;
  const gridData: (Post | null)[] = (() => {
    const visible = source.filter((p) => !hiddenIds.has(p.id));
    const remainder = visible.length % GRID_COLUMNS;
    if (remainder === 0) return visible;
    return [...visible, ...Array(GRID_COLUMNS - remainder).fill(null)];
  })();

  // Making a collection from the profile: name it, then go straight into it to
  // pick which posts belong.
  const createCollection = async (text: string) => {
    const problem = collectionNameProblem(
      text,
      collections.map((c) => c.name),
    );
    if (problem) {
      setNameError(problem);
      return;
    }
    try {
      const made = await svc.createCollection(text);
      setNaming(false);
      setNameError(null);
      setCollections((prev) => [made, ...prev]);
      navigation.navigate('Collection', {
        collectionId: made.id,
        name: made.name,
        pickPosts: true,
      });
    } catch (e: any) {
      setNameError(e?.message ?? 'Could not make that collection');
    }
  };

  // Your own profile leads with a "New collection" tile; padded to whole rows
  // so a lone last tile stays half width.
  type CollectionCell = Collection | 'new' | null;
  const collectionData: CollectionCell[] = (() => {
    const cells: CollectionCell[] = isMe ? ['new', ...collections] : [...collections];
    return cells.length % 2 ? [...cells, null] : cells;
  })();

  const header = (
    <View style={styles.headerWrap}>
      {!isMe ? (
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      ) : null}
      <View style={styles.card}>
        {isMe ? (
          <Pressable
            testID="profile-menu"
            onPress={() => setMenuOpen(true)}
            hitSlop={10}
            style={styles.menuBtn}
            accessibilityLabel="Your stuff"
          >
            <Ionicons name="menu" size={24} color={colors.cocoa} />
          </Pressable>
        ) : null}
        <View style={styles.topRow}>
          <Avatar user={profile} size={72} />
          <View style={styles.stats}>
            <Stat label="Posts" value={posts.length} onPress={scrollToPosts} />
            <Stat label="Followers" value={counts.followers} onPress={() => openList('followers')} />
            <Stat label="Following" value={counts.following} onPress={() => openList('following')} />
          </View>
        </View>
        <Text style={styles.name}>{profile?.display_name ?? '…'}</Text>
        <Muted>@{profile?.handle ?? ''}</Muted>
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        <View style={styles.streakRow}>
          <View style={styles.streakBadge}>
            <View style={styles.streakValue}>
              <Ionicons name="flame" size={16} color={colors.amber} />
              <Text style={styles.streakBig}>{streak?.current_streak ?? 0}</Text>
            </View>
            <Muted>day streak</Muted>
          </View>
          <View style={styles.streakBadge}>
            <View style={styles.streakValue}>
              <Ionicons name="trophy" size={15} color={colors.amber} />
              <Text style={styles.streakBig}>{streak?.longest_streak ?? 0}</Text>
            </View>
            <Muted>best streak</Muted>
          </View>
        </View>

        {isMe ? (
          <View style={styles.meButtons}>
            <Button
              title="Edit profile"
              variant="secondary"
              onPress={() => navigation.navigate('Settings', { section: 'profile' })}
              style={{ flex: 1 }}
            />
            <Button
              testID="profile-activity"
              title="Your activity"
              variant="secondary"
              onPress={() => navigation.navigate('Activity', { tab: 'liked' })}
              style={{ flex: 1 }}
            />
          </View>
        ) : blocked ? (
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <Muted style={{ textAlign: 'center' }}>
              You blocked this account. You will not see each other's posts.
            </Muted>
            <Button
              testID="unblock-user"
              title="Unblock"
              variant="secondary"
              onPress={async () => {
                await svc.unblockUser(userId);
                setBlocked(false);
                load();
                refreshFeed();
              }}
            />
          </View>
        ) : (
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <Button
                title={following ? 'Following ✓' : 'Follow'}
                variant={following ? 'secondary' : 'primary'}
                onPress={toggleFollow}
                style={{ flex: 1 }}
              />
              <Pressable
                testID="profile-more"
                onPress={() => setOtherMenuOpen(true)}
                hitSlop={10}
                style={styles.moreBtn}
                accessibilityLabel="More options"
              >
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.cocoaSoft} />
              </Pressable>
            </View>
            {confirmingBlock ? (
              <View style={styles.confirmBlock}>
                <Text style={styles.confirmBlockText}>
                  Block @{profile?.handle ?? ''}? You will not see each other's
                  posts, any follow between you is removed, and neither of you
                  can message the other.
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button
                    title="Cancel"
                    variant="secondary"
                    onPress={() => setConfirmingBlock(false)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    testID="block-confirm"
                    title="Block"
                    variant="danger"
                    onPress={async () => {
                      setConfirmingBlock(false);
                      await doBlock();
                    }}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : null}
          </View>
        )}
      </View>
      <View style={styles.profileTabs}>
        <Pressable
          testID="profile-tab-posts"
          onPress={() => setTab('posts')}
          style={[styles.profileTab, tab === 'posts' && styles.profileTabActive]}
        >
          <Ionicons
            name="grid"
            size={16}
            color={tab === 'posts' ? colors.amberDark : colors.cocoaSoft}
          />
          <Text style={[styles.profileTabText, tab === 'posts' && styles.profileTabTextActive]}>
            Posts
          </Text>
        </Pressable>
        <Pressable
          testID="profile-tab-reposts"
          onPress={() => setTab('reposts')}
          style={[styles.profileTab, tab === 'reposts' && styles.profileTabActive]}
        >
          <Ionicons
            name="repeat"
            size={18}
            color={tab === 'reposts' ? colors.amberDark : colors.cocoaSoft}
          />
          <Text style={[styles.profileTabText, tab === 'reposts' && styles.profileTabTextActive]}>
            Reposts
          </Text>
        </Pressable>
        <Pressable
          testID="profile-tab-collections"
          onPress={() => setTab('collections')}
          style={[styles.profileTab, tab === 'collections' && styles.profileTabActive]}
        >
          <Ionicons
            name="albums"
            size={16}
            color={tab === 'collections' ? colors.amberDark : colors.cocoaSoft}
          />
          <Text
            style={[styles.profileTabText, tab === 'collections' && styles.profileTabTextActive]}
          >
            Collections
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {tab === 'collections' ? (
        <FlatList
          // Two columns here vs three for posts, so it needs its own key.
          key="collections"
          ref={collectionsRef}
          testID="profile-collections"
          data={collectionData}
          keyExtractor={(c, i) => (c === 'new' ? 'new' : c?.id ?? `spacer-${i}`)}
          numColumns={2}
          ListHeaderComponent={header}
          columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullRefresh}
              tintColor={colors.amber}
              colors={[colors.amber]}
            />
          }
          contentContainerStyle={{ gap: spacing.lg, paddingBottom: 120 }}
          renderItem={({ item }) =>
            item === 'new' ? (
              <Pressable
                testID="collection-new-tile"
                onPress={() => {
                  setNameError(null);
                  setNaming(true);
                }}
                style={styles.collectionTile}
              >
                <View style={[styles.collectionCover, styles.collectionNew]}>
                  <Ionicons name="add" size={34} color={colors.amberDark} />
                </View>
                <Text style={[styles.collectionName, { color: colors.amberDark }]}>
                  New collection
                </Text>
              </Pressable>
            ) : item ? (
              <Pressable
                testID={`collection-tile-${item.id}`}
                onPress={() =>
                  navigation.navigate('Collection', { collectionId: item.id, name: item.name })
                }
                style={styles.collectionTile}
              >
                <View style={styles.collectionCover}>
                  {item.cover ? (
                    <PostThumb
                      post={item.cover}
                      radius={radius.lg}
                      style={{ width: '100%' }}
                      onPress={() =>
                        navigation.navigate('Collection', {
                          collectionId: item.id,
                          name: item.name,
                        })
                      }
                    />
                  ) : (
                    <Ionicons name="albums-outline" size={30} color={colors.cocoaFaint} />
                  )}
                </View>
                <Text style={styles.collectionName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.collectionCount}>
                  {item.post_count === 1 ? '1 post' : `${item.post_count} posts`}
                </Text>
              </Pressable>
            ) : (
              <View style={{ flex: 1 }} />
            )
          }
          ListEmptyComponent={
            loading ? null : (
              <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
                No collections yet
              </Muted>
            )
          }
        />
      ) : (
        <FlatList
          key="grid"
          ref={listRef}
          testID="profile-grid"
          data={gridData}
          keyExtractor={(p, i) => p?.id ?? `spacer-${i}`}
          numColumns={GRID_COLUMNS}
          onScrollToIndexFailed={() => {}}
          ListHeaderComponent={header}
          columnWrapperStyle={{ gap: GRID_GAP }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullRefresh}
              tintColor={colors.amber}
              colors={[colors.amber]}
            />
          }
          contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 120 }}
          renderItem={({ item }) =>
            item ? (
              <PostThumb
                post={item}
                onPress={() =>
                  openPostFeed(
                    navigation,
                    source.filter((p) => !hiddenIds.has(p.id)),
                    item.id,
                    tab === 'posts' ? 'Posts' : 'Reposts',
                  )
                }
                onLongPress={() => navigation.navigate('PostPeek', { postId: item.id })}
                style={{ flex: 1 }}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )
          }
          ListEmptyComponent={
            loading ? null : (
              <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
                {tab === 'posts'
                  ? 'No posts yet'
                  : isMe
                    ? 'Posts you repost show up here'
                    : 'No reposts yet'}
              </Muted>
            )
          }
        />
      )}

      <ActionSheet
        visible={otherMenuOpen}
        title={profile ? `@${profile.handle}` : undefined}
        onClose={() => setOtherMenuOpen(false)}
        actions={[
          {
            key: 'share-profile',
            label: 'Share profile',
            hint: 'Send it to friends or a group chat in NiblGo',
            icon: 'paper-plane-outline',
            onPress: () => navigation.navigate('ShareSheet', { userId }),
          },
          {
            key: 'report-account',
            label: 'Report account',
            hint: 'Send this profile to our moderation team',
            icon: 'flag-outline',
            destructive: true,
            onPress: () => navigation.navigate('Report', { reportedUserId: userId }),
          },
          {
            key: 'block',
            label: blocked ? 'Unblock' : 'Block',
            hint: blocked
              ? 'You will see each other again'
              : 'Hides you from each other and stops messages',
            icon: blocked ? 'lock-open-outline' : 'ban-outline',
            destructive: !blocked,
            onPress: blocked
              ? async () => {
                  await svc.unblockUser(userId);
                  setBlocked(false);
                  load();
                  refreshFeed();
                }
              : confirmBlock,
          },
        ]}
      />

      <RenameGroupSheet
        visible={naming}
        initial=""
        title="New collection"
        placeholder="Crockpot meals, desserts..."
        saveLabel="Create"
        maxLength={COLLECTION_NAME_MAX + 10}
        error={nameError}
        testIDPrefix="collection-name"
        onCancel={() => setNaming(false)}
        onSave={createCollection}
      />

      <ActivityDrawer
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        sections={[
          {
            title: 'Your activity',
            items: [
              {
                key: 'interactions',
                label: 'Activity',
                hint: 'Likes and comments on your posts',
                icon: 'notifications-outline',
                onPress: () => navigation.navigate('Notifications'),
              },
              {
                key: 'liked',
                label: 'Liked',
                hint: 'Posts you have hearted',
                icon: 'heart-outline',
                onPress: () => navigation.navigate('Activity', { tab: 'liked' }),
              },
              {
                key: 'saved',
                label: 'Saved',
                hint: 'Your private bookmarks',
                icon: 'bookmark-outline',
                onPress: () => navigation.navigate('Activity', { tab: 'saved' }),
              },
              {
                key: 'commented',
                label: 'Comments',
                hint: 'Posts you have replied to',
                icon: 'chatbubble-outline',
                onPress: () => navigation.navigate('Activity', { tab: 'commented' }),
              },
            ],
          },
          {
            title: 'Social',
            items: [
              {
                key: 'messages',
                label: 'Messages',
                hint: 'Your direct messages',
                icon: 'paper-plane-outline',
                onPress: () => navigation.navigate('Inbox'),
              },
              {
                key: 'streaks',
                label: 'Streaks',
                hint: 'Leaderboard and your best run',
                icon: 'flame-outline',
                onPress: () => navigation.navigate('Leaderboard'),
              },
            ],
          },
          {
            title: 'Settings',
            items: [
              {
                key: 'edit-profile',
                label: 'Edit profile',
                hint: 'Photo, name, and bio',
                icon: 'person-outline',
                onPress: () => navigation.navigate('Settings', { section: 'profile' }),
              },
              {
                key: 'share-profile',
                label: 'Share your profile',
                hint: 'Send it to friends or a group chat',
                icon: 'paper-plane-outline',
                onPress: () => navigation.navigate('ShareSheet', { userId }),
              },
              {
                key: 'notifications',
                label: 'Notifications',
                hint: 'Mealtime reminder times',
                icon: 'notifications-outline',
                onPress: () => navigation.navigate('Settings', { section: 'notifications' }),
              },
              {
                key: 'privacy',
                label: 'Privacy',
                hint: 'Who can see your follower list',
                icon: 'lock-closed-outline',
                onPress: () => navigation.navigate('Settings', { section: 'privacy' }),
              },
              {
                key: 'blocked',
                label: 'Blocked accounts',
                hint: 'People you have blocked',
                icon: 'ban-outline',
                onPress: () => navigation.navigate('Blocked'),
              },
              {
                key: 'account',
                label: 'Account',
                hint: 'Sign out or delete your account',
                icon: 'log-out-outline',
                danger: true,
                onPress: () => navigation.navigate('Settings', { section: 'account' }),
              },
            ],
          },
          {
            title: 'Help',
            items: [
              {
                key: 'feedback',
                label: 'Send feedback',
                hint: 'Ideas, requests, anything you think',
                icon: 'chatbox-ellipses-outline',
                onPress: () => navigation.navigate('Feedback', { kind: 'feedback' }),
              },
              {
                key: 'bug',
                label: 'Report a problem',
                hint: 'Something is broken or behaving oddly',
                icon: 'bug-outline',
                onPress: () => navigation.navigate('Feedback', { kind: 'bug' }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

function Stat({
  label,
  value,
  onPress,
}: {
  label: string;
  value: number;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.stat} onPress={onPress} hitSlop={6}>
      <Text style={styles.statNum}>{value}</Text>
      <Muted>{label}</Muted>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  headerWrap: {
    padding: spacing.lg,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: -4,
    marginBottom: spacing.sm,
  },
  backText: {
    fontFamily: fonts.bold,
    color: colors.amberDark,
    fontSize: 15,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...(shadowSoft as object),
  },
  moreBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.creamDark,
  },
  confirmBlock: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
    padding: spacing.md,
    gap: spacing.sm,
  },
  confirmBlockText: {
    fontFamily: fonts.semi,
    fontSize: 13,
    lineHeight: 18,
    color: colors.cocoa,
  },
  menuBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 2,
    padding: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginLeft: spacing.lg,
  },
  stat: {
    alignItems: 'center',
  },
  statNum: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.cocoa,
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.cocoa,
    marginTop: spacing.md,
  },
  bio: {
    fontFamily: fonts.semi,
    fontSize: 14.5,
    color: colors.cocoaSoft,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  streakRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  streakBadge: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  meButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  streakValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  streakBig: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.cocoa,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.cocoa,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  profileTabs: {
    flexDirection: 'row',
    backgroundColor: colors.creamDark,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  profileTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  profileTabActive: { backgroundColor: colors.white, ...(shadowSoft as object) },
  profileTabText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoaSoft },
  profileTabTextActive: { color: colors.amberDark },
  collectionTile: { flex: 1 },
  collectionCover: {
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.creamDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectionNew: {
    backgroundColor: colors.amberSoft,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.amber,
  },
  collectionName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.cocoa,
    marginTop: spacing.sm,
  },
  collectionCount: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint },
});
