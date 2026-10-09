import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Muted } from '../components/ui';
import { filterUsers } from '../lib/userFilter';
import { getDataService } from '../services';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { User } from '../types';

/**
 * Followers / following for a user, with a toggle to flip between the two
 * (whichever you tapped on the profile opens first) and a search box that
 * filters the list by name or @handle. Also shows who liked a comment.
 *
 * If the target user's lists are private (and it isn't you), the screen still
 * opens but shows a private notice instead of the names.
 */
export function UserListScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const { userId, mode, displayName, isPrivate, isMe, commentId, postId } = route.params as {
    userId?: string;
    mode: 'followers' | 'following' | 'comment_likes' | 'post_likes';
    displayName?: string;
    isPrivate?: boolean;
    isMe?: boolean;
    /** Set when mode is 'comment_likes'. */
    commentId?: string;
    /** Set when mode is 'post_likes' (the heart on your own post). */
    postId?: string;
  };
  const svc = getDataService();
  const insets = useSafeAreaInsets();
  const isLikes = mode === 'comment_likes' || mode === 'post_likes';
  const isFollowMode = !isLikes;
  // Which follow list is showing; starts on whichever one you tapped.
  const [tab, setTab] = useState<'followers' | 'following'>(
    mode === 'following' ? 'following' : 'followers',
  );
  const listMode = isFollowMode ? tab : mode;
  const [followers, setFollowers] = useState<User[]>([]);
  const [following, setFollowing] = useState<User[]>([]);
  const [likers, setLikers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  // Only follower/following lists can be private; comment likes are public.
  const gated = isFollowMode && !!isPrivate && !isMe;
  const listName =
    listMode === 'followers' ? 'Followers' : listMode === 'following' ? 'Following' : 'Likes';
  const title = isFollowMode ? (displayName ?? listName) : 'Likes';

  const load = useCallback(async () => {
    if (gated) {
      setLoading(false);
      return;
    }
    if (mode === 'comment_likes') {
      setLikers(await svc.getCommentLikers(commentId!));
    } else if (mode === 'post_likes') {
      setLikers(await svc.getPostLikers(postId!));
    } else {
      // Both at once, so the toggle flips instantly and shows both counts.
      const [a, b] = await Promise.all([
        svc.getFollowers(userId!),
        svc.getFollowingUsers(userId!),
      ]);
      setFollowers(a);
      setFollowing(b);
    }
    setLoading(false);
  }, [svc, userId, mode, gated, commentId, postId]);

  const users =
    listMode === 'followers' ? followers : listMode === 'following' ? following : likers;
  const shown = useMemo(() => filterUsers(users, query), [users, query]);
  const searching = query.trim().length > 0;

  // Reload on coming back too, so someone you just blocked or unfollowed from
  // their profile is gone from the list.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // The toggle and search bar scroll with the list (only the Back bar stays
  // put), so a swipe that starts on them still scrolls.
  const controls = (
    <>
      {isFollowMode ? (
        <View style={styles.tabs}>
          {(['followers', 'following'] as const).map((key) => {
            const active = tab === key;
            const count = key === 'followers' ? followers.length : following.length;
            return (
              <Pressable
                key={key}
                testID={`userlist-tab-${key}`}
                onPress={() => setTab(key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {gated || loading ? '' : `${count} `}
                  {key === 'followers' ? 'Followers' : 'Following'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {gated ? null : (
        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={colors.cocoaFaint} />
          <TextInput
            keyboardAppearance={colors.dark ? 'dark' : 'light'}
            testID="userlist-search"
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${listName.toLowerCase()}`}
            placeholderTextColor={colors.cocoaFaint}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="never"
          />
          {query ? (
            <Pressable testID="userlist-search-clear" onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.cocoaFaint} />
            </Pressable>
          ) : null}
        </View>
      )}
    </>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {isFollowMode ? null : (
            <Muted style={{ textAlign: 'center' }}>People who liked this comment</Muted>
          )}
        </View>
        <View style={{ width: 30 }} />
      </View>

      {gated ? (
        <>
          {controls}
          <View style={styles.gate}>
            <Ionicons name="lock-closed-outline" size={44} color={colors.cocoaFaint} />
            <Text style={styles.privateTitle}>{listName} are private</Text>
            <Muted style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
              {displayName} keeps their {listName.toLowerCase()} list private
            </Muted>
          </View>
        </>
      ) : (
        <FlatList
          testID="userlist"
          data={shown}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // The list has side padding; the toggle and search carry their own.
          ListHeaderComponent={<View style={styles.listHeader}>{controls}</View>}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`userlist-row-${item.id}`}
              style={styles.row}
              onPress={() => navigation.push('UserProfile', { userId: item.id })}
            >
              <Avatar user={item} size={46} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.name}>{item.display_name}</Text>
                <Muted>@{item.handle}</Muted>
                {item.bio ? (
                  <Text style={styles.bio} numberOfLines={1}>
                    {item.bio}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.cocoaFaint} />
            </Pressable>
          )}
          ListEmptyComponent={
            loading ? null : searching && users.length > 0 ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={40} color={colors.cocoaFaint} />
                <Text style={styles.emptyTitle}>No one matches “{query.trim()}”</Text>
                <Muted style={styles.emptyBody}>Try part of their name or @handle</Muted>
              </View>
            ) : isLikes ? (
              <View testID="likes-empty" style={styles.empty}>
                <Ionicons name="heart-outline" size={44} color={colors.cocoaFaint} />
                <Text style={styles.emptyTitle}>No likes yet</Text>
                <Muted style={styles.emptyBody}>
                  {mode === 'post_likes'
                    ? "When someone likes your post, they'll show up here"
                    : 'Be the first to like this comment'}
                </Muted>
              </View>
            ) : (
              // Give the empty case the same weight as the private one: an
              // icon, a headline, and a line telling you what to do next.
              <View style={styles.empty}>
                <Ionicons
                  name={listMode === 'followers' ? 'people-outline' : 'person-add-outline'}
                  size={44}
                  color={colors.cocoaFaint}
                />
                <Text style={styles.emptyTitle}>
                  {listMode === 'followers'
                    ? isMe
                      ? 'No followers yet'
                      : 'No followers yet'
                    : isMe
                      ? "You're not following anyone"
                      : 'Not following anyone'}
                </Text>
                <Muted style={styles.emptyBody}>
                  {listMode === 'followers'
                    ? isMe
                      ? 'Share a meal or two and people will start following you'
                      : `When someone follows ${displayName}, they'll show up here`
                    : isMe
                      ? 'Find people in Discover and their meals will fill your feed'
                      : `${displayName} hasn't followed anyone yet`}
                </Muted>
                {isMe ? (
                  <Pressable
                    testID="empty-discover"
                    style={styles.emptyCta}
                    onPress={() => navigation.navigate('Tabs', { screen: 'Discover' })}
                  >
                    <Ionicons name="compass-outline" size={17} color={colors.onAmber} />
                    <Text style={styles.emptyCtaText}>Find people</Text>
                  </Pressable>
                ) : null}
              </View>
            )
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors, { shadowSoft }) => ({
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
  backBtn: {
    width: 30,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cocoa,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...(shadowSoft as object),
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 15.5,
    color: colors.cocoa,
  },
  bio: {
    fontFamily: fonts.semi,
    fontSize: 12.5,
    color: colors.cocoaFaint,
    marginTop: 2,
  },
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: 80,
    paddingHorizontal: spacing.xl,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: 70,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.cocoa,
    textAlign: 'center',
  },
  emptyBody: {
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.amber,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    marginTop: spacing.sm,
  },
  emptyCtaText: {
    fontFamily: fonts.bold,
    fontSize: 14.5,
    color: colors.onAmber,
  },
  listHeader: { marginHorizontal: -spacing.lg, marginBottom: spacing.sm },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.creamDark,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  tabActive: { backgroundColor: colors.raised, ...(shadowSoft as object) },
  tabText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoaSoft },
  tabTextActive: { color: colors.amberDark },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.semi,
    fontSize: 15,
    color: colors.cocoa,
    paddingVertical: 0,
  },
  privateTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.cocoa,
  },
}));
