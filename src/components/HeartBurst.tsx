import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

export type HeartBurstHandle = { pop: () => void };

const useNative = Platform.OS !== 'web';

/**
 * The big heart that pops over a photo when you double-tap to like it: springs
 * up, holds a beat, then fades. Sits over whatever it's placed in and never
 * takes touches.
 */
export const HeartBurst = forwardRef<HeartBurstHandle>(function HeartBurst(_props, ref) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useImperativeHandle(ref, () => ({
    pop: () => {
      scale.stopAnimation();
      opacity.stopAnimation();
      scale.setValue(0.3);
      opacity.setValue(1);
      Animated.sequence([
        Animated.spring(scale, {
          toValue: 1,
          friction: 4,
          tension: 120,
          useNativeDriver: useNative,
        }),
        Animated.delay(250),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: useNative,
          }),
          Animated.timing(scale, { toValue: 1.15, duration: 220, useNativeDriver: useNative }),
        ]),
      ]).start();
    },
  }));

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View testID="heart-burst" style={{ opacity, transform: [{ scale }] }}>
        <Ionicons name="heart" size={104} color="#FFFFFF" style={styles.heart} />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: {
    textShadowColor: 'rgba(0, 0, 0, 0.25)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
});
