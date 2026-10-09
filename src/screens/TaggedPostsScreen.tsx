import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostThumb } from '../components/PostThumb';
import { Muted } from '../components/ui';
import { openPostFeed } from '../lib/postFeed';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, spacing, makeStyles, useColors } from '../theme';
import { Post } from '../types';

const GRID_COLUMNS = 3;
const GRID_GAP = 2;

/**
 * Posts someone has been tagged in, opened from "Tagged posts" in their
 * profile's ··· menu. A grid that taps into the usual mini feed.
 *
 * Only for people you follow (the menu only offers it then). Checked again
 * here so a stale link, say right after unfollowing, shows the lock instead.
 */
export function TaggedPostsScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const { userId, name } = route.params as { userId: string; name?: string };
  const svc = getDataService();
  const { hiddenIds, user } = useApp();
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const isMe = userId === user?.id;
          const follows = isMe || (await svc.getFollowingIds()).includes(userId);
          if (!alive) return;
          setLocked(!follows);
          setPosts(follows ? await svc.getTaggedPosts(userId) : []);
        } catch {
          if (alive) setPosts([]);
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [svc, userId, user?.id]),
  );

  const visible = posts.filter((p) => !hiddenIds.has(p.id));
  // Pad to whole rows so a lone final tile stays a third wide.
  const remainder = visible.length % GRID_COLUMNS;
  const gridData: (Post | null)[] = remainder
    ? [...visible, ...Array(GRID_COLUMNS - remainder).fill(null)]
    : visible;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.title}>Tagged</Text>
          {name ? (
            <Text style={styles.sub} numberOfLines={1}>
              {name}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : locked ? (
        <View testID="tagged-locked" style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.cocoaFaint} />
          <Muted style={{ textAlign: 'center' }}>
            {name
              ? `Follow ${name} to see posts they're tagged in`
              : "Follow them to see posts they're tagged in"}
          </Muted>
        </View>
      ) : (
        <FlatList
          testID="tagged-grid"
          data={gridData}
          keyExtractor={(p, i) => p?.id ?? `spacer-${i}`}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 120 }}
          renderItem={({ item }) =>
            item ? (
              <PostThumb
                post={item}
                onPress={() => openPostFeed(navigation, visible, item.id, 'Tagged')}
                onLongPress={() => navigation.navigate('PostPeek', { postId: item.id })}
                style={{ flex: 1 }}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="pricetag-outline" size={40} color={colors.cocoaFaint} />
              <Muted style={{ textAlign: 'center' }}>
                {name ? `${name} hasn't been tagged in any posts yet` : 'No tagged posts yet'}
              </Muted>
            </View>
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 60, marginLeft: -4 },
  back: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  sub: { fontFamily: fonts.semi, fontSize: 13, color: colors.cocoaFaint },
  empty: { alignItems: 'center', gap: spacing.md, marginTop: 60, paddingHorizontal: spacing.xl },
}));
