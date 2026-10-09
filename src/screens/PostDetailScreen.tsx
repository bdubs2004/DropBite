import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useZooming } from '../components/PinchZoom';
import { PostCard } from '../components/PostCard';
import { Muted } from '../components/ui';
import { feedWindow, takePosts } from '../lib/postFeed';
import { usePostActions } from '../lib/usePostActions';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, spacing, makeStyles, useColors } from '../theme';
import { Post } from '../types';

/**
 * A post, opened from a grid (Profile, Discover, Search, Your stuff) or a link.
 *
 * From a grid it's a mini feed, like Instagram: the post you tapped sits at the
 * top and you can keep scrolling through the rest of that grid, down to the
 * older ones or back up to the newer ones. Opened any other way (a
 * notification, a DM, a link) it's just that one post, loaded by id so counts
 * are current and it works when the caller only has an id.
 */
export function PostDetailScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const postId: string = route.params.postId;
  const svc = getDataService();
  const { user, hiddenIds } = useApp();
  const insets = useSafeAreaInsets();
  // Hold the list still while a photo in it is being pinched.
  const zooming = useZooming();

  // The grid this was opened from, if any (see src/lib/postFeed.ts). Read once:
  // the list stays put while you scroll it.
  const initial = useMemo(() => {
    const list = takePosts(route.params?.feedKey);
    return list ? feedWindow(list.filter((p) => !hiddenIds.has(p.id)), postId) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isFeed = !!initial && initial.posts.length > 0;
  const startIndex = isFeed ? initial!.index : 0;

  const [posts, setPosts] = useState<Post[]>(isFeed ? initial!.posts : []);
  const [loading, setLoading] = useState(!isFeed);
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => posts.filter((p) => !hiddenIds.has(p.id)), [posts, hiddenIds]);

  // Hiding a post (you just reported it) takes it out of the feed. If that
  // leaves nothing to show, step back to wherever you came from.
  useEffect(() => {
    if (isFeed ? posts.length > 0 && visible.length === 0 : hiddenIds.has(postId)) {
      navigation.goBack();
    }
  }, [isFeed, posts.length, visible.length, hiddenIds, postId, navigation]);

  // Re-pull just these posts (counts after commenting, liking elsewhere) and
  // drop any that were deleted, without touching the rest of the list.
  const refreshPosts = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const fresh = await Promise.all(ids.map((id) => svc.getPost(id).catch(() => undefined)));
      setPosts((prev) =>
        prev.flatMap((p) => {
          const i = ids.indexOf(p.id);
          if (i < 0) return [p];
          if (fresh[i] === null) return [];
          return [fresh[i] ?? p];
        }),
      );
    },
    [svc],
  );

  // The posts currently on screen, so a refresh only re-pulls those.
  const onScreen = useRef<string[]>([postId]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    onScreen.current = viewableItems.map((v) => (v.item as Post).id);
  }).current;

  // `showSpinner` only for the very first load of a single post: a focus
  // reload after commenting or liking refreshes the numbers silently rather
  // than blanking the card out behind a spinner.
  const loadSingle = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      const p = await svc.getPost(postId);
      setPosts(p ? [p] : []);
      setLoading(false);
    },
    [svc, postId],
  );

  // Reload every time the screen regains focus so a comment added (or a like
  // toggled) in the Comments modal is reflected in the counts on return. The
  // feed's first focus has nothing to catch up on: the grid just loaded it.
  const firstLoad = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (!isFeed) loadSingle(firstLoad.current);
      else if (!firstLoad.current) refreshPosts(onScreen.current);
      firstLoad.current = false;
    }, [isFeed, loadSingle, refreshPosts]),
  );

  // When opened from the long-press peek's comment button, slide the comments
  // sheet up over this post once. A ref guard keeps it from reopening every
  // time the screen regains focus (e.g. after closing the comments).
  const openedComments = useRef(false);
  useEffect(() => {
    if (route.params?.openComments && !openedComments.current) {
      openedComments.current = true;
      navigation.navigate('Comments', { postId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pullRefresh = async () => {
    setRefreshing(true);
    try {
      if (isFeed) await refreshPosts(onScreen.current);
      else await loadSingle(false);
    } finally {
      setRefreshing(false);
    }
  };

  const {
    like,
    showLikes,
    comment,
    share,
    repost,
    save,
    remove,
    report,
    addToCollection,
    tagPeople,
    untagMe,
  } = usePostActions(navigation, NO_REFRESH);

  // Deleting a post takes it out of the list; if it was the only one, there's
  // nothing left to show, so step back.
  // Stable (reads the list through a ref) so the memoised post cards don't
  // all re-render whenever this screen does.
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const removeAndUpdate = useCallback(
    async (p: Post) => {
      await remove(p);
      const rest = postsRef.current.filter((x) => x.id !== p.id);
      setPosts(rest);
      if (!isFeed || rest.length === 0) navigation.goBack();
    },
    [remove, isFeed, navigation],
  );
  const openUser = useCallback(
    (uid: string) => navigation.push('UserProfile', { userId: uid }),
    [navigation],
  );

  // Open with the tapped post at the top. FlatList can only jump to a row once
  // the rows above it have been measured, so render down to it up front, jump
  // as soon as the measurements are in, and keep the list invisible until
  // then so you never see it scroll.
  const listRef = useRef<FlatList<Post>>(null);
  const [positioned, setPositioned] = useState(startIndex === 0);
  const jumpFailed = useRef(false);
  const jumpTries = useRef(0);
  const jumpToStart = useCallback(() => {
    if (positioned) return;
    jumpFailed.current = false;
    listRef.current?.scrollToIndex({ index: startIndex, animated: false });
    if (!jumpFailed.current || ++jumpTries.current > 40) {
      // Done, or measuring never settled: show the list either way.
      setPositioned(true);
      return;
    }
    setTimeout(jumpToStart, 25);
  }, [positioned, startIndex]);

  // Stay on the tapped post after the jump, too. The posts above it keep
  // changing height for a moment (their photos load and take their real
  // shape, text settles), and every change slid the list so you ended up
  // looking at the next post. Until you scroll yourself, re-pin the tapped
  // post to the top whenever the content changes size. Once you scroll, the
  // list is yours (and on a phone maintainVisibleContentPosition keeps what
  // you're looking at still while things above it resize).
  const userMoved = useRef(false);
  // Each post's measured height. The pin adds up the posts above the tapped
  // one itself rather than asking the list where it is: the list only notices
  // a post moved when that post's own size changes, so after one above it
  // grows its record of where the tapped post sits is out of date.
  const heights = useRef(new Map<string, number>());
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const holdStart = useCallback(() => {
    if (!positioned || userMoved.current || startIndex === 0) return;
    const pin = () => {
      if (userMoved.current) return;
      const above = visibleRef.current.slice(0, startIndex);
      const sizes = above.map((p) => heights.current.get(p.id));
      if (sizes.some((h) => h === undefined)) {
        // Something above isn't measured yet: fall back to the list's own idea.
        listRef.current?.scrollToIndex({ index: startIndex, animated: false });
        return;
      }
      const offset = LIST_TOP_PAD + sizes.reduce((sum: number, h) => sum + (h as number), 0);
      listRef.current?.scrollToOffset({ offset, animated: false });
    };
    // The size change can be reported before the list has re-measured the
    // post that changed, so pin again once those measurements are in.
    requestAnimationFrame(pin);
    setTimeout(pin, 80);
    setTimeout(pin, 250);
  }, [positioned, startIndex]);
  const letGo = () => {
    userMoved.current = true;
  };
  // A mouse wheel in a web browser fires none of the touch events above, so
  // there the hold just ends after a few seconds rather than fight a scroll.
  useEffect(() => {
    if (Platform.OS !== 'web' || !positioned) return;
    const t = setTimeout(letGo, 4000);
    return () => clearTimeout(t);
  }, [positioned]);

  const title = isFeed
    ? route.params?.title ?? 'Posts'
    : posts[0]?.user?.display_name
      ? `${posts[0].user.display_name}'s Post`
      : 'Post';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          ref={listRef}
          testID="post-feed"
          scrollEnabled={!zooming}
          data={visible}
          keyExtractor={(p) => p.id}
          style={{ opacity: positioned ? 1 : 0 }}
          contentContainerStyle={{ paddingTop: LIST_TOP_PAD, paddingBottom: 120 }}
          initialNumToRender={startIndex + 2}
          onContentSizeChange={() => {
            if (!positioned) setTimeout(jumpToStart, 0);
            else holdStart();
          }}
          onTouchStart={letGo}
          onScrollBeginDrag={letGo}
          onMomentumScrollBegin={letGo}
          maintainVisibleContentPosition={isFeed ? { minIndexForVisible: 0 } : undefined}
          onScrollToIndexFailed={() => {
            jumpFailed.current = true;
          }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 30 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullRefresh}
              tintColor={colors.amber}
              colors={[colors.amber]}
            />
          }
          renderItem={({ item }) => (
            <View onLayout={(e) => heights.current.set(item.id, e.nativeEvent.layout.height)}>
              <PostCard
                post={item}
                onToggleLike={like}
                onShowLikes={showLikes}
                onComment={comment}
                onShare={share}
                onRepost={repost}
                onToggleSave={save}
                onPressUser={openUser}
                onDelete={removeAndUpdate}
                onReport={report}
                onAddToCollection={addToCollection}
                onTagPeople={tagPeople}
                onUntagMe={untagMe}
                isMine={item.user_id === user?.id}
              />
            </View>
          )}
          ListEmptyComponent={
            <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
              This post is no longer available
            </Muted>
          }
        />
      )}
    </View>
  );
}

/** This screen refreshes its posts itself; stable so actions stay stable. */
const NO_REFRESH = () => {};

/** Space above the first post in the list. */
const LIST_TOP_PAD = spacing.md;

const useStyles = makeStyles((colors) => ({
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    width: 60,
    marginLeft: -4,
  },
  back: {
    fontFamily: fonts.bold,
    color: colors.amberDark,
    fontSize: 15,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cocoa,
  },
}));
