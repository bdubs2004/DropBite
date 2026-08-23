import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

/**
 * The brand animation that plays after a post goes up: a fork rises and pulls
 * the NiblGo wordmark up out of the gradient, then withdraws.
 *
 * This plays the designed artwork rather than reproducing it in code — the
 * timing and easing are part of the design. The source GIF was 3.3 MB; it
 * ships as an animated WebP at about 200 KB, which every platform we target
 * decodes natively. expo-image is used because plain RN Image does not animate
 * WebP reliably on Android.
 */

/** Length of the artwork. Keep in sync if the animation is ever re-exported. */
const ANIMATION_MS = 4000;

export function PostSuccessOverlay({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  const [skippable, setSkippable] = useState(false);

  // Hold the latest callback without restarting the timer.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!visible) {
      setSkippable(false);
      return;
    }
    // Four seconds is a long time to hold someone up, so offer an out shortly
    // after it starts rather than trapping them for the whole run.
    const showSkip = setTimeout(() => setSkippable(true), 900);
    const finish = setTimeout(() => doneRef.current(), ANIMATION_MS);
    return () => {
      clearTimeout(showSkip);
      clearTimeout(finish);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent>
      <Pressable
        testID="post-success"
        style={styles.root}
        onPress={() => doneRef.current()}
        accessibilityLabel="Posted. Tap to continue."
      >
        <Image
          source={require('../../assets/post-success.webp')}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // The artwork is the animation; no crossfade on mount.
          transition={0}
          autoplay
        />
        {skippable ? (
          <View style={styles.skipWrap} pointerEvents="none">
            <Text style={styles.skip}>Tap to continue</Text>
          </View>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.amber,
    justifyContent: 'flex-end',
  },
  skipWrap: {
    alignItems: 'center',
    paddingBottom: 54,
  },
  skip: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.3,
  },
});
