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
import { fonts, spacing, makeStyles, useColors, photoGrid } from '../theme';
import { Post } from '../types';

const GRID_COLUMNS = photoGrid.columns;
const GRID_GAP = photoGrid.gap;

/**
 * Every dish with one hashtag, newest first, opened by tapping a tag under a
 * post (or a tag suggestion in Search). A grid that taps into the usual mini
 * feed, like TikTok's hashtag pages.
 */
export function HashtagScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const { tag } = route.params as { tag: string };
  const svc = getDataService();
  const { hiddenIds } = useApp();
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      svc
        .searchPosts(`#${tag}`)
        // "#bbq" also matches tags starting with bbq; this page is one tag.
        .then((p) => alive && setPosts(p.filter((x) => x.hashtags?.includes(tag))))
        .catch(() => alive && setPosts([]))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, [svc, tag]),
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
          <Text testID="hashtag-title" style={styles.title} numberOfLines={1}>
            #{tag}
          </Text>
          {!loading ? (
            <Text style={styles.sub}>
              {visible.length} {visible.length === 1 ? 'dish' : 'dishes'}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          testID="hashtag-grid"
          data={gridData}
          keyExtractor={(p, i) => p?.id ?? `spacer-${i}`}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: photoGrid.side }}
          contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 120 }}
          renderItem={({ item }) =>
            item ? (
              <PostThumb
                post={item}
                onPress={() => openPostFeed(navigation, visible, item.id, `#${tag}`)}
                onLongPress={() => navigation.navigate('PostPeek', { postId: item.id })}
                style={{ flex: 1 }}
                radius={photoGrid.radius}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyHash}>#</Text>
              <Muted style={{ textAlign: 'center' }}>
                No dishes with #{tag} yet. Add it to your next post
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
  emptyHash: { fontFamily: fonts.display, fontSize: 40, color: colors.cocoaFaint },
}));
