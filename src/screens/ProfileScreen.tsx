import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { PostCard } from '../components/PostCard';
import { Button, Muted } from '../components/ui';
import { usePostActions } from '../lib/usePostActions';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { Post, Streak, User } from '../types';

/**
 * Shows either my own profile (tab) or another user's (pushed from feed).
 */
export function ProfileScreen({ navigation, route }: any) {
  const { user: me, refreshFeed } = useApp();
  const svc = getDataService();
  const insets = useSafeAreaInsets();

  const userId: string = route?.params?.userId ?? me?.id;
  const isMe = userId === me?.id;
  const listRef = useRef<FlatList<Post>>(null);

  const [otherProfile, setOtherProfile] = useState<User | null>(null);
  // For my own profile, read straight from live context so a saved bio /
  // name shows the moment Settings updates it.
  const profile = isMe ? me : otherProfile;
  const [posts, setPosts] = useState<Post[]>([]);
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
      const [userPosts, s, c, followingIds] = await Promise.all([
        svc.getUserPosts(userId),
        svc.getStreak(userId),
        svc.getFollowCounts(userId),
        svc.getFollowingIds(),
      ]);
      setPosts(userPosts);
      setStreak(s);
      setCounts(c);
      setFollowing(followingIds.includes(userId));
      if (!isMe) {
        const all = await svc.listUsers();
        setOtherProfile(all.find((u) => u.id === userId) ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [svc, userId, isMe, me]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFollow = async () => {
    if (following) await svc.unfollow(userId);
    else await svc.follow(userId);
    setFollowing(!following);
    load();
    refreshFeed();
  };

  const { like, comment, share, repost } = usePostActions(navigation, load);

  const header = (
    <View style={styles.headerWrap}>
      {!isMe ? (
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={10}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
      ) : null}
      <View style={styles.card}>
        <View style={styles.topRow}>
          <Avatar user={profile} size={72} />
          <View style={styles.stats}>
            <Stat label="posts" value={posts.length} onPress={scrollToPosts} />
            <Stat label="followers" value={counts.followers} onPress={() => openList('followers')} />
            <Stat label="following" value={counts.following} onPress={() => openList('following')} />
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
          <Button
            title="Settings"
            variant="secondary"
            onPress={() => navigation.navigate('Settings')}
            style={{ marginTop: spacing.lg }}
          />
        ) : (
          <Button
            title={following ? 'Following ✓' : 'Follow'}
            variant={following ? 'secondary' : 'primary'}
            onPress={toggleFollow}
            style={{ marginTop: spacing.lg }}
          />
        )}
      </View>
      {posts.length ? (
        <Text style={styles.sectionTitle}>Posts</Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        ref={listRef}
        data={posts}
        keyExtractor={(p) => p.id}
        onScrollToIndexFailed={() => {}}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onToggleLike={like}
            onComment={comment}
            onShare={share}
            onRepost={repost}
            onPressUser={(uid) => navigation.push('UserProfile', { userId: uid })}
          />
        )}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          loading ? null : (
            <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
              No posts yet.
            </Muted>
          )
        }
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
});
