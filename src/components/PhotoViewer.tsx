import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  GestureResponderEvent,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeTapHandler } from '../lib/doubleTap';
import { MAX_SCALE, pinchTransform, Point } from '../lib/pinchMath';

const useNative = Platform.OS !== 'web';
/** Drag down this far (unzoomed) and let go to close. */
const DISMISS_DISTANCE = 120;
/** Double-tap zooms to this. */
const DOUBLE_TAP_SCALE = 2.5;

// On web, stop the browser zooming or scrolling the page under your fingers
// (it skews finger positions); every gesture here belongs to the photo.
const webTouch = (Platform.OS === 'web' ? { touchAction: 'none' } : null) as ViewStyle | null;

const touchesOf = (e: GestureResponderEvent): Point[] =>
  (e.nativeEvent.touches ?? []).map((t) => ({ x: t.pageX, y: t.pageY }));

/**
 * Full-screen photo, opened by tapping a picture in a chat.
 *
 * Pinch to zoom (it stays zoomed until you zoom back out), drag to look around
 * while zoomed, double-tap to zoom in on that spot or back out, and when it's
 * not zoomed, swipe down to close, like Photos and Instagram.
 */
export function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');
  const center = { x: width / 2, y: height / 2 };

  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const g = useRef({
    scale: 1,
    t: { x: 0, y: 0 } as Point,
    baseScale: 1,
    baseT: { x: 0, y: 0 } as Point,
    start: [] as Point[],
    count: 0,
    moved: false,
    firstTouch: { x: 0, y: 0 } as Point,
  }).current;

  const apply = () => {
    scale.setValue(g.scale);
    tx.setValue(g.t.x);
    ty.setValue(g.t.y);
  };

  const animateTo = (s: number, t: Point, then?: () => void) => {
    g.scale = s;
    g.t = t;
    setZoomed(s > 1.01);
    const cfg = { useNativeDriver: useNative, friction: 8, tension: 70 };
    Animated.parallel([
      Animated.spring(scale, { toValue: s, ...cfg }),
      Animated.spring(tx, { toValue: t.x, ...cfg }),
      Animated.spring(ty, { toValue: t.y, ...cfg }),
    ]).start(() => then?.());
  };

  // Keep a zoomed photo from being dragged off into empty space.
  const clampPan = (s: number, t: Point): Point => {
    const maxX = Math.max(0, (width * s - width) / 2);
    const maxY = Math.max(0, (height * s - height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, t.x)),
      y: Math.min(maxY, Math.max(-maxY, t.y)),
    };
  };

  // Fresh every time a photo opens.
  useEffect(() => {
    if (uri) {
      g.scale = 1;
      g.t = { x: 0, y: 0 };
      apply();
      setZoomed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const lastTapAt = useRef<Point>({ x: 0, y: 0 });
  const taps = useRef(
    makeTapHandler({
      onDouble: () => {
        if (g.scale > 1.01) {
          animateTo(1, { x: 0, y: 0 });
          return;
        }
        // Zoom in around the spot you tapped.
        const p = lastTapAt.current;
        const s = DOUBLE_TAP_SCALE;
        const t = { x: (center.x - p.x) * (s - 1), y: (center.y - p.y) * (s - 1) };
        animateTo(s, clampPan(s, t));
      },
    }),
  ).current;

  const rebase = (touches: Point[]) => {
    g.count = touches.length;
    g.start = touches;
    g.baseScale = g.scale;
    g.baseT = g.t;
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        scale.stopAnimation();
        tx.stopAnimation();
        ty.stopAnimation();
        const touches = touchesOf(e);
        g.moved = false;
        g.firstTouch = touches[0] ?? { x: 0, y: 0 };
        rebase(touches);
      },
      onPanResponderMove: (e) => {
        const touches = touchesOf(e);
        if (!touches.length) return;
        if (touches.length !== g.count) {
          rebase(touches);
          return;
        }
        const d = Math.hypot(touches[0].x - g.firstTouch.x, touches[0].y - g.firstTouch.y);
        if (d > 8 || touches.length > 1) g.moved = true;
        if (touches.length === 1 && g.baseScale <= 1.01) {
          // Not zoomed: one finger drags the photo down to close it.
          g.scale = 1;
          g.t = { x: 0, y: Math.max(0, touches[0].y - g.start[0].y) };
        } else {
          const next = pinchTransform({
            center,
            start: g.start,
            now: touches,
            baseScale: g.baseScale,
            baseT: g.baseT,
          });
          g.scale = Math.min(MAX_SCALE, next.scale);
          g.t = next.t;
        }
        apply();
      },
      onPanResponderRelease: (e) => {
        if (!g.moved) {
          lastTapAt.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
          taps.tap();
          return;
        }
        if (g.scale <= 1.01) {
          if (g.t.y > DISMISS_DISTANCE) {
            closeRef.current();
            return;
          }
          animateTo(1, { x: 0, y: 0 });
          return;
        }
        animateTo(g.scale, clampPan(g.scale, g.t));
      },
      onPanResponderTerminate: () => {
        animateTo(g.scale > 1.01 ? g.scale : 1, clampPan(g.scale, g.t));
      },
    }),
  ).current;

  // The black behind it lightens as you drag it down to close.
  const backdrop = ty.interpolate({
    inputRange: [0, 300],
    outputRange: [1, 0.3],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: zoomed ? 1 : backdrop }]}
      />
      <View testID="photo-viewer" style={[StyleSheet.absoluteFill, webTouch]} {...pan.panHandlers}>
        {uri ? (
          <Animated.View
            testID="photo-viewer-image"
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateX: tx }, { translateY: ty }, { scale }] },
            ]}
          >
            <Image
              source={{ uri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          </Animated.View>
        ) : null}
      </View>
      <Pressable
        testID="photo-viewer-close"
        onPress={onClose}
        hitSlop={12}
        style={[styles.close, { top: insets.top + 10 }]}
        accessibilityLabel="Close photo"
      >
        <Ionicons name="close" size={26} color="#FFFFFF" />
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  close: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
