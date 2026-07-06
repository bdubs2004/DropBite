import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { PostCard } from '../components/PostCard';
import { Button, Muted } from '../components/ui';
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

  const [profile, setProfile] = useState<User | null>(isMe ? me : null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

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
      if (isMe) {
        setProfile(me);
      } else {
        const all = await svc.listUsers();
        setProfile(all.find((u) => u.id === userId) ?? null);
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

  const toggleLike = async (post: Post) => {
    await svc.toggleReaction(post.id);
    load();
  };

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
            <Stat label="posts" value={posts.length} />
            <Stat label="followers" value={counts.followers} />
            <Stat label="following" value={counts.following} />
          </View>
        </View>
        <Text style={styles.name}>{profile?.display_name ?? '…'}</Text>
        <Muted>@{profile?.handle ?? ''}</Muted>
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        <View style={styles.streakRow}>
          <View style={styles.streakBadge}>
            <Text style={styles.streakBig}>🔥 {streak?.current_streak ?? 0}</Text>
            <Muted>day streak</Muted>
          </View>
          <View style={styles.streakBadge}>
            <Text style={styles.streakBig}>🏆 {streak?.longest_streak ?? 0}</Text>
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
        <Text style={styles.sectionTitle}>{isMe ? 'My drops' : 'Drops'}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <PostCard post={item} onToggleLike={toggleLike} />}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          loading ? null : (
            <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
              No drops yet.
            </Muted>
          )
        }
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{value}</Text>
      <Muted>{label}</Muted>
    </View>
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
