import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  NativeScrollEvent,
  Platform,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoLockup } from '../components/Logo';
import { MEAL_PLANS_ENABLED } from '../config';
import { useZooming } from '../components/PinchZoom';
import { PostCard } from '../components/PostCard';
import { Button, Muted } from '../components/ui';
import { analytics } from '../lib/analytics';
import { HeaderScrollState, nextHeaderState } from '../lib/autoHideHeader';
import { usePostActions } from '../lib/usePostActions';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { Post } from '../types';

export function FeedScreen({ navigation }: any) {
  const styles = useStyles();
  const colors = useColors();
  const { feed, feedLoading, refreshFeed, streak, user } = useApp();
  const insets = useSafeAreaInsets();
  // Hold the list still while a photo in it is being pinched.
  const zooming = useZooming();
  const svc = getDataService();
  const [unread, setUnread] = useState(0);
  const [unseen, setUnseen] = useState(0);

  // Refresh both badges whenever the feed comes back into view, so reading a
  // thread or opening Activity clears them without a manual reload.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      svc.getUnreadCount().then((n) => alive && setUnread(n));
      svc.getUnreadNotificationCount().then((n) => alive && setUnseen(n));
      return () => {
        alive = false;
      };
    }, [svc]),
  );
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
  } = usePostActions(navigation, refreshFeed);

  const listRef = useRef<FlatList<any>>(null);

  // The pull-down spinner is only for a pull. It used to follow every feed
  // reload (liking from a comment sheet, following someone, posting), and on
  // iPhone switching a RefreshControl on without a pull shoves the list down
  // and back while you're scrolling it, which is the jumpiness on Home.
  const [pulling, setPulling] = useState(false);
  const onPull = useCallback(async () => {
    setPulling(true);
    try {
      await refreshFeed();
    } finally {
      setPulling(false);
    }
  }, [refreshFeed]);
  // Analytics: posts by other people that were really on screen (most of the
  // card showing), not just rendered ahead of the scroll.
  const meRef = useRef(user?.id);
  meRef.current = user?.id;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    analytics().postsViewed(
      viewableItems
        .map((v) => v.item as Post)
        .filter((p) => p && p.user_id !== meRef.current)
        .map((p) => p.id),
    );
  }).current;

  // Auto-hiding header: slides completely off the screen as you scroll down
  // and comes back as soon as you scroll up a little, so the feed gets the
  // full screen without the header being hard to reach.
  //
  // It slides by its real, measured height. It used to slide a fixed 58pt,
  // but on Dynamic Island iPhones the header is taller than that (the status
  // bar inset is ~59pt), so the logo row was left parked between the clock
  // and the battery.
  const headerY = useRef(new Animated.Value(0)).current;
  const headerHeight = useRef(insets.top + HEADER_HEIGHT);
  const scrollState = useRef<HeaderScrollState>({ lastY: 0, travel: 0, hidden: false });

  const setHeaderHidden = useCallback(
    (next: boolean) => {
      Animated.timing(headerY, {
        toValue: next ? -headerHeight.current : 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    },
    [headerY],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const prev = scrollState.current;
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      // Stays put until you've scrolled past the header itself, and ignores
      // the bounce at the end of the feed.
      const next = nextHeaderState(prev, contentOffset.y, {
        topZone: headerHeight.current - insets.top,
        maxY: contentSize.height - layoutMeasurement.height,
      });
      scrollState.current = next;
      if (next.hidden !== prev.hidden) setHeaderHidden(next.hidden);
    },
    [setHeaderHidden, insets.top],
  );

  // Tapping Home while already on Home jumps to the top and pulls fresh posts,
  // the way Instagram behaves. The event comes from the custom TabBar in
  // App.tsx, which emits `tabPress` itself.
  const jumpToTopAndRefresh = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    scrollState.current = { lastY: 0, travel: 0, hidden: false };
    setHeaderHidden(false);
    refreshFeed();
  }, [refreshFeed, setHeaderHidden]);

  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      jumpToTopAndRefresh();
    });
    return unsub;
  }, [navigation, jumpToTopAndRefresh]);

  const openProfile = useCallback(
    (userId: string) => navigation.navigate('UserProfile', { userId }),
    [navigation],
  );

  // Stable, so the posts on screen don't all re-render when something else on
  // this screen changes, notably the scroll lock flipping as a pinch-zoom
  // starts and ends (which made zooming stutter).
  const meId = user?.id;
  const renderPost = useCallback(
    ({ item }: { item: Post }) => (
      <PostCard
        post={item}
        onToggleLike={like}
        onShowLikes={showLikes}
        onComment={comment}
        onShare={share}
        onRepost={repost}
        onToggleSave={save}
        onPressUser={openProfile}
        onDelete={remove}
        onReport={report}
        onAddToCollection={addToCollection}
        onTagPeople={tagPeople}
        onUntagMe={untagMe}
        isMine={item.user_id === meId}
      />
    ),
    [
      like,
      showLikes,
      comment,
      share,
      repost,
      save,
      openProfile,
      remove,
      report,
      addToCollection,
      tagPeople,
      untagMe,
      meId,
    ],
  );

  return (
    <View style={styles.root}>
      {/* A solid strip behind the clock and battery, so posts never scroll
          underneath them; the header slides away beneath it. */}
      <View
        testID="status-bar-cover"
        pointerEvents="none"
        style={[styles.statusCover, { height: insets.top }]}
      />
      {/* box-none: the logo and buttons still take taps, but a swipe that
          starts on the bar's empty space goes through to the feed underneath
          and scrolls it. */}
      <Animated.View
        testID="feed-header"
        pointerEvents="box-none"
        onLayout={(e) => {
          headerHeight.current = e.nativeEvent.layout.height;
        }}
        style={[
          styles.header,
          { paddingTop: insets.top, transform: [{ translateY: headerY }] },
        ]}
      >
        <Pressable
          testID="feed-logo"
          onPress={jumpToTopAndRefresh}
          hitSlop={10}
          accessibilityLabel="Refresh feed"
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
        >
          <LogoLockup height={30} />
        </Pressable>
        <View
          style={[styles.headerRight, MEAL_PLANS_ENABLED && styles.headerButtons]}
          pointerEvents="box-none"
        >
        {MEAL_PLANS_ENABLED ? (
          <Pressable
            testID="mealplan-pill"
            onPress={() => navigation.navigate('MealPlan')}
            style={({ pressed }) => [styles.streakPill, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Meal plan"
          >
            <Ionicons name="calendar" size={15} color={colors.amber} />
          </Pressable>
        ) : null}
        <Pressable
          testID="streak-pill"
          onPress={() => navigation.navigate('Leaderboard')}
          style={({ pressed }) => [styles.streakPill, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Streak leaderboard"
        >
          <Ionicons name="flame" size={15} color={colors.amber} />
          <Text style={styles.streakText}>{streak?.current_streak ?? 0}</Text>
        </Pressable>
        <Pressable
          testID="bell-pill"
          onPress={() => navigation.navigate('Notifications')}
          style={({ pressed }) => [styles.streakPill, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Activity"
        >
          <Ionicons name="notifications" size={15} color={colors.amber} />
          {unseen > 0 ? (
            <View testID="bell-badge" style={styles.unreadDot}>
              <Text style={styles.unreadText}>{unseen > 9 ? '9+' : unseen}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          testID="inbox-pill"
          onPress={() => navigation.navigate('Inbox')}
          style={({ pressed }) => [styles.streakPill, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Messages"
        >
          <Ionicons name="paper-plane" size={15} color={colors.amber} />
          {unread > 0 ? (
            <View testID="inbox-badge" style={styles.unreadDot}>
              <Text style={styles.unreadText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </Pressable>
        </View>
      </Animated.View>

      <FlatList
        ref={listRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        testID="feed-list"
        scrollEnabled={!zooming}
        data={feed}
        keyExtractor={(p) => p.id}
        renderItem={renderPost}
        // Posts are tall (a full photo each): render a few at a time instead
        // of ten, so a fast flick doesn't stall the scroll while a whole batch
        // of cards is built.
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={9}
        removeClippedSubviews={Platform.OS === 'android'}
        viewabilityConfig={VIEWABILITY}
        onViewableItemsChanged={onViewableItemsChanged}
        contentContainerStyle={{
          paddingTop: insets.top + HEADER_HEIGHT + spacing.md,
          paddingBottom: 120,
        }}
        progressViewOffset={insets.top + HEADER_HEIGHT}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={onPull}
            tintColor={colors.amber}
            colors={[colors.amber]}
          />
        }
        ListEmptyComponent={
          feedLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.amber} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="restaurant-outline" size={44} color={colors.cocoaFaint} />
              <Text style={styles.emptyTitle}>Your feed is empty</Text>
              <Muted style={{ textAlign: 'center' }}>
                Follow a few friends to see what they're eating
              </Muted>
              <Button
                testID="feed-invite"
                title="Invite friends"
                small
                onPress={() => navigation.navigate('Invite')}
                style={{ marginTop: spacing.md }}
              />
            </View>
          )
        }
      />

      {/* A reloading wheel for refreshes that aren't a pull gesture — tapping
          the logo or the Home tab — where the RefreshControl never shows. Only
          when there is already content, so it doesn't double up with the
          empty-state spinner on first load. */}
      {feedLoading && !pulling && feed.length > 0 ? (
        <View
          pointerEvents="none"
          style={[styles.reloadWheel, { top: insets.top + HEADER_HEIGHT + spacing.sm }]}
        >
          <ActivityIndicator size="small" color={colors.amber} />
        </View>
      ) : null}
    </View>
  );
}

/** Height of the header bar below the safe-area inset. */
const HEADER_HEIGHT = 58;
// A post counts as seen once most of it has been on screen.
const VIEWABILITY = { itemVisiblePercentThreshold: 60, minimumViewTime: 500 };

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    height: undefined,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.cream,
  },
  statusCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    backgroundColor: colors.cream,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // With meal plans on, the four buttons sit together, centered in the
  // space to the right of the logo.
  headerButtons: {
    flex: 1,
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
  unreadDot: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    fontFamily: fonts.bold,
    fontSize: 10.5,
    color: colors.white,
  },
  // The three buttons on the right share one size: same height, same
  // padding, at least round, so they line up as a set.
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 34,
    minWidth: 34,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
  },
  streakText: {
    fontFamily: fonts.display,
    fontSize: 14,
    color: colors.cocoa,
  },
  // Plain amber spinner, no card behind it — matches the Discover tab.
  reloadWheel: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 1,
  },
  empty: {
    alignItems: 'center',
    padding: spacing.xxl,
    marginTop: 60,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.cocoa,
    marginVertical: spacing.md,
  },
}));
