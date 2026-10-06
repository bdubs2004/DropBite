import React, {
  createContext,
  ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  GestureResponderEvent,
  PanResponder,
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { makeTapHandler } from '../lib/doubleTap';
import { pinchTransform, Point } from '../lib/pinchMath';

type Rect = { x: number; y: number; width: number; height: number };

type Host = {
  show: (node: ReactNode, rect: Rect) => void;
  hide: () => void;
  lock: (on: boolean) => void;
  scale: Animated.Value;
  tx: Animated.Value;
  ty: Animated.Value;
};

const ZoomContext = createContext<Host | null>(null);
const ZoomingContext = createContext(false);
const ZoomCopyContext = createContext(false);

/**
 * True inside the copy of a photo that's drawn while you pinch it. A photo
 * uses it to appear instantly there (no fade-in) at the shape it already
 * knows, so swapping the real photo for its copy is invisible.
 */
export function useIsZoomCopy() {
  return useContext(ZoomCopyContext);
}

/**
 * True while a photo is being pinched. Lists of posts pass
 * `scrollEnabled={!zooming}` so they hold still under your fingers.
 *
 * This has to be explicit: on iOS a touch owned by a view INSIDE a scroll view
 * doesn't stop that scroll view from scrolling, so without the lock any drift
 * in the pinch would scroll the feed and cancel the zoom.
 */
export function useZooming() {
  return useContext(ZoomingContext);
}
const useNative = Platform.OS !== 'web';

/**
 * Where a zoomed photo is drawn while you pinch it.
 *
 * Mounted once at the app root so the photo can grow over everything: the
 * header, the tab bar, the posts above and below it. It never takes touches
 * (pointerEvents none); the original photo underneath keeps the finger.
 */
export function ZoomHost({ children }: { children: ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const [active, setActive] = useState<{ node: ReactNode; rect: Rect } | null>(null);
  const [locked, setLocked] = useState(false);

  const host = useMemo<Host>(
    () => ({
      show: (node, rect) => setActive({ node, rect }),
      hide: () => setActive(null),
      lock: setLocked,
      scale,
      tx,
      ty,
    }),
    [scale, tx, ty],
  );


  return (
    <ZoomContext.Provider value={host}>
      <ZoomingContext.Provider value={locked}>
        <View style={{ flex: 1 }}>
          {children}
          {active ? (
            <View testID="zoom-overlay" pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Animated.View
                testID="zoom-photo"
                style={{
                  position: 'absolute',
                  left: active.rect.x,
                  top: active.rect.y,
                  width: active.rect.width,
                  height: active.rect.height,
                  transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                }}
              >
                <ZoomCopyContext.Provider value={true}>{active.node}</ZoomCopyContext.Provider>
              </Animated.View>
            </View>
          ) : null}
        </View>
      </ZoomingContext.Provider>
    </ZoomContext.Provider>
  );
}

// On web, stop the browser pinch-zooming the whole page instead (which also
// skews finger positions), while still letting a vertical swipe scroll.
const webTouch = (Platform.OS === 'web' ? { touchAction: 'pan-y' } : null) as ViewStyle | null;

const touchesOf = (e: GestureResponderEvent): Point[] =>
  (e.nativeEvent.touches ?? []).map((t) => ({ x: t.pageX, y: t.pageY }));

/**
 * Pinch a photo to zoom it, Instagram style: two fingers grow it in place
 * around the point you pinched, you can drag it around while zoomed, and it
 * springs back the moment you let go.
 *
 * One finger still scrolls the list and long-presses (pass `onLongPress`);
 * only a second finger landing turns it into a zoom.
 *
 * Why there are two layers: React Native only offers a new finger to views
 * ABOVE whichever view already owns the touch. If the first finger is owned by
 * the post card around the photo, the photo is never asked about the second
 * one. So the inner layer owns the first finger itself (without stopping the
 * list from scrolling), which puts the outer layer above the owner, where it
 * gets to claim the second finger and lock the list while you pinch.
 */
export function PinchZoom({
  children,
  style,
  onLongPress,
  onDoubleTap,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onLongPress?: () => void;
  /** Two quick taps on the photo (a post photo uses it to like). */
  onDoubleTap?: () => void;
}) {
  const host = useContext(ZoomContext);
  const hostRef = useRef(host);
  hostRef.current = host;

  // Fallback values for when there's no ZoomHost above (e.g. inside a native
  // modal, which draws over the root): zoom in place instead.
  const local = useRef({
    scale: new Animated.Value(1),
    tx: new Animated.Value(0),
    ty: new Animated.Value(0),
  }).current;
  const values = () => hostRef.current ?? local;

  const wrapRef = useRef<View>(null);
  const longPressRef = useRef(onLongPress);
  longPressRef.current = onLongPress;
  const doubleTapRef = useRef(onDoubleTap);
  doubleTapRef.current = onDoubleTap;
  const taps = useRef(makeTapHandler({ onDouble: () => doubleTapRef.current?.() })).current;
  const [zooming, setZooming] = useState(false);
  const childrenRef = useRef(children);
  childrenRef.current = children;

  const g = useRef({
    rect: { x: 0, y: 0, width: 0, height: 0 } as Rect,
    measured: false,
    count: 0,
    startTouches: [] as Point[],
    // Where the fingers were last seen, for starting the zoom from there once
    // the photo has been measured (so it doesn't jump to catch up).
    lastTouches: [] as Point[],
    baseScale: 1,
    baseT: { x: 0, y: 0 } as Point,
    scale: 1,
    t: { x: 0, y: 0 } as Point,
  }).current;

  const apply = () => {
    const v = values();
    v.scale.setValue(g.scale);
    v.tx.setValue(g.t.x);
    v.ty.setValue(g.t.y);
  };

  // Start measuring from wherever the fingers are now, keeping the current
  // zoom. Called when the gesture starts and whenever a finger lands or lifts,
  // so the photo never jumps.
  const rebase = (touches: Point[]) => {
    g.count = touches.length;
    g.startTouches = touches;
    g.baseScale = g.scale;
    g.baseT = g.t;
  };

  const springBack = () => {
    const v = values();
    // A firm, quick settle with no wobble: overshooting would shrink the photo
    // below its size and bounce it, which reads as a glitch.
    const cfg = {
      useNativeDriver: useNative,
      stiffness: 320,
      damping: 32,
      mass: 1,
      overshootClamping: true,
      restDisplacementThreshold: 0.001,
      restSpeedThreshold: 0.001,
    };
    Animated.parallel([
      Animated.spring(v.scale, { toValue: 1, ...cfg }),
      Animated.spring(v.tx, { toValue: 0, ...cfg }),
      Animated.spring(v.ty, { toValue: 0, ...cfg }),
    ]).start(() => {
      hostRef.current?.hide();
      hostRef.current?.lock(false);
      setZooming(false);
    });
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (e) => touchesOf(e).length >= 2,
      onMoveShouldSetPanResponderCapture: (e) => touchesOf(e).length >= 2,
      // Once you're zooming, nothing (the list scrolling, the card's
      // long-press) gets to take the finger away.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        cancelHold();
        const v = values();
        v.scale.stopAnimation();
        v.tx.stopAnimation();
        v.ty.stopAnimation();
        g.scale = 1;
        g.t = { x: 0, y: 0 };
        g.measured = false;
        apply();
        rebase(touchesOf(e));
        g.lastTouches = g.startTouches;
        hostRef.current?.lock(true);
        // No host: the photo zooms in place, nothing to wait for.
        if (!hostRef.current) setZooming(true);
        const found = (rect: Rect) => {
          g.rect = rect;
          g.measured = true;
          // Start from where the fingers are now, not where they landed.
          rebase(g.lastTouches);
          // Show the copy and hide the original in the same update, so there's
          // never a frame with no photo (the original used to vanish a frame
          // or two before its copy appeared).
          hostRef.current?.show(childrenRef.current, rect);
          setZooming(true);
        };
        if (Platform.OS === 'web') {
          // react-native-web's measureInWindow is approximate (it walks
          // offsetParents and misses scroll offsets); the browser knows exactly.
          const r = (wrapRef.current as any)?.getBoundingClientRect?.();
          if (r) found({ x: r.left, y: r.top, width: r.width, height: r.height });
        } else {
          wrapRef.current?.measureInWindow((x, y, width, height) =>
            found({ x, y, width, height }),
          );
        }
      },
      onPanResponderMove: (e) => {
        const touches = touchesOf(e);
        if (touches.length === 0) return;
        g.lastTouches = touches;
        // Wait for the photo's position (one frame) so the zoom is anchored
        // in the right place; it then starts from these latest touches.
        if (!g.measured) return;
        if (touches.length !== g.count) {
          rebase(touches);
          return;
        }
        const center = {
          x: g.rect.x + g.rect.width / 2,
          y: g.rect.y + g.rect.height / 2,
        };
        const next = pinchTransform({
          center,
          start: g.startTouches,
          now: touches,
          baseScale: g.baseScale,
          baseT: g.baseT,
        });
        g.scale = next.scale;
        g.t = next.t;
        apply();
      },
      onPanResponderRelease: springBack,
      onPanResponderTerminate: springBack,
    }),
  ).current;

  // The inner layer: owns a single finger (see the note above) and turns a
  // still hold into a long-press, since it now stands in for the card's.
  const hold = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    fired: boolean;
    moved: boolean;
    x: number;
    y: number;
  }>({ timer: null, fired: false, moved: false, x: 0, y: 0 }).current;
  const cancelHold = () => {
    if (hold.timer) clearTimeout(hold.timer);
    hold.timer = null;
  };
  const finger = {
    onStartShouldSetResponder: () => true,
    // The list scrolling (or the pinch above) can always take it.
    onResponderTerminationRequest: () => true,
    onResponderGrant: (e: GestureResponderEvent) => {
      hold.x = e.nativeEvent.pageX;
      hold.y = e.nativeEvent.pageY;
      cancelHold();
      hold.fired = false;
      hold.moved = false;
      if (longPressRef.current) {
        hold.timer = setTimeout(() => {
          hold.timer = null;
          hold.fired = true;
          longPressRef.current?.();
        }, 350);
      }
      // Not blocking: the list must still scroll from a finger on the photo.
      return false;
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const dx = e.nativeEvent.pageX - hold.x;
      const dy = e.nativeEvent.pageY - hold.y;
      if (Math.hypot(dx, dy) > 10 || touchesOf(e).length > 1) {
        hold.moved = true;
        cancelHold();
      }
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      cancelHold();
      // A clean tap (no drag, no long-press) counts toward a double-tap.
      if (!hold.moved && !hold.fired) taps.tap();
      // On web, lifting the finger after a long-press makes the browser fire a
      // click right where it was, which would land on the menu's backdrop and
      // shut the menu it just opened.
      if (hold.fired) e.preventDefault();
    },
    onResponderTerminate: cancelHold,
  };

  // With a host, the original hides while its copy is drawn on top. Without
  // one, the original itself is transformed (and lifted over its siblings).
  const inPlace = !host;
  return (
    <View
      ref={wrapRef}
      testID="pinch-zoom"
      collapsable={false}
      style={[
        style,
        webTouch,
        zooming && !inPlace && { opacity: 0 },
        zooming && inPlace && { zIndex: 50, elevation: 50 },
      ]}
      {...pan.panHandlers}
    >
      <View {...finger}>
        {inPlace ? (
          <Animated.View
            style={{
              transform: [{ translateX: local.tx }, { translateY: local.ty }, { scale: local.scale }],
            }}
          >
            {children}
          </Animated.View>
        ) : (
          children
        )}
      </View>
    </View>
  );
}
