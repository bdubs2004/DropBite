import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  StyleProp,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

const SHOW_MS = 2400;
const SLIDE_MS = 220;
const useNative = Platform.OS !== 'web';

/**
 * A greyed-out hint that rolls through examples ("Search #chinese", then
 * "#healthy", ...), like TikTok's search bar before you type. Sits over an
 * empty text box; it doesn't take touches, so a tap still lands on the box.
 *
 * Rolls only while `active` (the box is empty and the screen is showing), and
 * swaps without the slide when the phone asks for reduced motion.
 */
export function RollingHint({
  prefix,
  items,
  active,
  onChange,
  style,
  textStyle,
}: {
  prefix: string;
  items: string[];
  active: boolean;
  /** Told the example now showing, so the screen can search it on Return. */
  onChange?: (item: string) => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const [index, setIndex] = useState(0);
  const shift = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => (reduceMotion.current = on))
      .catch(() => {});
  }, []);

  useEffect(() => {
    onChange?.(items[index % items.length]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items]);

  useEffect(() => {
    if (!active || items.length < 2) return;
    let stopped = false;
    const t = setInterval(() => {
      if (reduceMotion.current) {
        setIndex((i) => (i + 1) % items.length);
        return;
      }
      Animated.parallel([
        Animated.timing(shift, { toValue: -10, duration: SLIDE_MS, useNativeDriver: useNative }),
        Animated.timing(fade, { toValue: 0, duration: SLIDE_MS, useNativeDriver: useNative }),
      ]).start(() => {
        if (stopped) {
          // Typing started mid-roll: leave the hint whole for next time.
          shift.setValue(0);
          fade.setValue(1);
          return;
        }
        setIndex((i) => (i + 1) % items.length);
        shift.setValue(10);
        Animated.parallel([
          Animated.timing(shift, { toValue: 0, duration: SLIDE_MS, useNativeDriver: useNative }),
          Animated.timing(fade, { toValue: 1, duration: SLIDE_MS, useNativeDriver: useNative }),
        ]).start();
      });
    }, SHOW_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [active, items.length, shift, fade]);

  return (
    // The gap, not a trailing space: the browser drops a space at the end of a line.
    <View pointerEvents="none" style={[{ flexDirection: 'row', alignItems: 'center', gap: 5 }, style]}>
      <Text style={textStyle} numberOfLines={1}>
        {prefix}
      </Text>
      <Animated.Text
        testID="rolling-hint"
        numberOfLines={1}
        style={[textStyle, { flexShrink: 1, opacity: fade, transform: [{ translateY: shift }] }]}
      >
        {items[index % items.length]}
      </Animated.Text>
    </View>
  );
}
