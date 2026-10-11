import { Ionicons } from '@expo/vector-icons';
import { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACTIVITY_KIND, BANNER_KINDS, IS_FOLLOW, SHOWS_COMMENT } from '../lib/activityKinds';
import { relativeTime } from '../lib/time';
import { getDataService } from '../services';
import { onActivityPushWhileOpen, setActivityBannersInApp } from '../services/notifications';
import { useApp } from '../state/AppContext';
import { fonts, makeStyles, radius, spacing, useColors } from '../theme';
import { AppNotification } from '../types';
import { Avatar } from './Avatar';
import { PostThumb } from './PostThumb';

/** How long a banner stays before it slides away on its own. */
const SHOW_MS = 5000;
/** Older than this by the time it could show, and it's not news any more. */
const FRESH_MS = 2 * 60 * 1000;
/** At most this many waiting; a burst shows the latest few, not a long parade. */
const MAX_WAITING = 3;
/** Far enough up to be fully off screen, notch included. */
const HIDDEN_Y = -260;
/**
 * Screens that open as native modals sit above the app's own views, so a
 * banner would be hidden behind them: hold it until you're back. Posting
 * (Compose) holds it too, so nothing interrupts the posting flow.
 */
const HOLD_ON = new Set([
  'Compose',
  'Comments',
  'Report',
  'PostPeek',
  'Feedback',
  'NewMessage',
  'ShareSheet',
  'AddToCollection',
  'TagPeople',
]);
/** Already looking at Activity: the list shows it, no banner needed. */
const SKIP_ON = new Set(['Notifications']);

const useNative = Platform.OS !== 'web';

/**
 * Activity that arrives while you're using the app drops down from the top as
 * a banner: the same line you'd see in Activity, with a little tab under it.
 * Swipe it up (by the tab or the card) to send it away, tap it to open what
 * happened, or leave it and it slides off after a few seconds.
 *
 * Only the kinds that also send a push (likes, comments, replies, comment
 * likes, follows) get a banner. Off entirely with Settings > In-app banners.
 */
export function ActivityBanner({
  navigationRef,
}: {
  navigationRef: NavigationContainerRefWithCurrent<any>;
}) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const { user, prefs } = useApp();
  const enabled = !!user && prefs.inAppBanners !== false;
  const meId = user?.id;

  const [current, setCurrent] = useState<AppNotification | null>(null);
  const showing = useRef(false);
  const waiting = useRef<AppNotification[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const y = useRef(new Animated.Value(HIDDEN_Y)).current;

  const routeName = useCallback(
    () => (navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined),
    [navigationRef],
  );

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const hide = useCallback(
    (then?: () => void) => {
      clearTimer();
      Animated.timing(y, { toValue: HIDDEN_Y, duration: 200, useNativeDriver: useNative }).start(
        () => {
          showing.current = false;
          setCurrent(null);
          then?.();
          // Next one, after a breath so two don't blur into one.
          setTimeout(() => pumpRef.current(), 250);
        },
      );
    },
    [y],
  );

  const startTimer = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => hide(), SHOW_MS);
  }, [hide]);

  // Show the next waiting banner if nothing is up and the screen allows it.
  const pump = useCallback(() => {
    if (showing.current) return;
    const route = routeName();
    if (route && HOLD_ON.has(route)) return;
    const now = Date.now();
    waiting.current = waiting.current.filter(
      (n) => now - Date.parse(n.created_at) < FRESH_MS,
    );
    if (route && SKIP_ON.has(route)) {
      waiting.current = [];
      return;
    }
    const next = waiting.current.shift();
    if (!next) return;
    showing.current = true;
    setCurrent(next);
    y.setValue(HIDDEN_Y);
    Animated.spring(y, {
      toValue: 0,
      useNativeDriver: useNative,
      stiffness: 260,
      damping: 26,
      mass: 1,
    }).start();
    startTimer();
  }, [routeName, startTimer, y]);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  // Look for Activity this banner hasn't seen yet.
  const check = useCallback(async () => {
    try {
      const list = await svc.getNotifications();
      if (!seen.current) {
        // First look: everything already there is old news.
        seen.current = new Set(list.map((n) => n.id));
        return;
      }
      const now = Date.now();
      const fresh = list
        .filter((n) => !seen.current!.has(n.id))
        .filter(
          (n) =>
            BANNER_KINDS.has(n.type) &&
            n.actor_id !== meId &&
            now - Date.parse(n.created_at) < FRESH_MS,
        )
        .reverse(); // oldest first, so they show in the order they happened
      for (const n of list) seen.current.add(n.id);
      if (!fresh.length) return;
      waiting.current = [...waiting.current, ...fresh].slice(-MAX_WAITING);
      pumpRef.current();
    } catch {
      // Offline for a moment; the next nudge tries again.
    }
  }, [svc, meId]);

  // Watch while signed in and switched on.
  useEffect(() => {
    setActivityBannersInApp(enabled);
    if (!enabled) return;
    seen.current = null;
    waiting.current = [];
    check(); // takes the starting point
    const stopWatching = svc.watchActivity(check);
    const stopPush = onActivityPushWhileOpen(check);
    // Leaving a held screen lets a waiting banner through.
    const stopNav = navigationRef.addListener('state', () => pumpRef.current());
    return () => {
      stopWatching();
      stopPush();
      stopNav();
      clearTimer();
      waiting.current = [];
      seen.current = null;
      showing.current = false;
      setCurrent(null);
      y.setValue(HIDDEN_Y);
    };
  }, [enabled, svc, check, navigationRef, y]);

  // Drag it up to send it away; a pull down just stretches a little.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) =>
          Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => clearTimer(),
        onPanResponderMove: (_, g) => y.setValue(g.dy < 0 ? g.dy : g.dy * 0.2),
        onPanResponderRelease: (_, g) => {
          if (g.dy < -28 || (g.vy < -0.4 && g.dy < -10)) hide();
          else {
            Animated.spring(y, { toValue: 0, useNativeDriver: useNative }).start();
            startTimer();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(y, { toValue: 0, useNativeDriver: useNative }).start();
          startTimer();
        },
      }),
    [y, hide, startTimer],
  );

  if (!current) return null;
  const n = current;
  const kind = ACTIVITY_KIND[n.type];
  const name = n.actor?.display_name ?? 'Someone';
  const said = SHOWS_COMMENT.has(n.type) && n.comment_text ? `: ${n.comment_text}` : '';

  // Same places a tap on the Activity line goes.
  const open = () => {
    hide(() => {
      if (IS_FOLLOW.has(n.type)) navigationRef.navigate('UserProfile', { userId: n.actor_id });
      else if (!n.post_id) return;
      else if (SHOWS_COMMENT.has(n.type)) navigationRef.navigate('Comments', { postId: n.post_id });
      else navigationRef.navigate('PostDetail', { postId: n.post_id });
    });
  };

  return (
    <Animated.View
      testID="activity-banner"
      style={[styles.wrap, { top: insets.top + spacing.sm, transform: [{ translateY: y }] }]}
      {...pan.panHandlers}
    >
      <Pressable
        testID="activity-banner-open"
        onPress={open}
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${name} ${kind.verb}${said}`}
        accessibilityHint="Opens it. Swipe up to dismiss"
      >
        <View>
          <Avatar user={n.actor} size={40} />
          <View style={[styles.kindBadge, { backgroundColor: colors[kind.tone] }]}>
            <Ionicons
              name={kind.icon}
              size={10}
              color={kind.tone === 'danger' ? colors.white : colors.onAmber}
            />
          </View>
        </View>
        <View style={styles.body}>
          <Text testID="activity-banner-text" style={styles.text} numberOfLines={2}>
            <Text style={styles.name}>{name}</Text> {kind.verb}
            {said}
          </Text>
          <Text style={styles.time}>{relativeTime(n.created_at)}</Text>
        </View>
        {n.post && !IS_FOLLOW.has(n.type) ? (
          <PostThumb post={n.post} radius={8} style={styles.thumb} />
        ) : null}
      </Pressable>
      {/* The little tab: something obvious to grab and flick up. */}
      <View testID="activity-banner-tab" style={styles.tab}>
        <View style={styles.grip} />
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors, { shadow }) => ({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 1000,
    elevation: 12,
    alignItems: 'center',
  },
  card: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...(shadow as object),
  },
  kindBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.card,
  },
  body: { flex: 1, marginLeft: spacing.md },
  text: { fontFamily: fonts.semi, fontSize: 14, lineHeight: 19, color: colors.cocoa },
  name: { fontFamily: fonts.bold },
  time: { fontFamily: fonts.semi, fontSize: 11.5, color: colors.cocoaFaint, marginTop: 2 },
  thumb: { width: 44, height: 44, marginLeft: spacing.md },
  // Hangs under the card's middle, the same colour, so card and tab read as one.
  tab: {
    marginTop: -1,
    width: 46,
    height: 14,
    backgroundColor: colors.card,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grip: { width: 22, height: 4, borderRadius: 2, backgroundColor: colors.cocoaFaint },
}));
