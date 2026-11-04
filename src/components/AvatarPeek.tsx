import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, Pressable, StyleSheet } from 'react-native';
import { makeStyles } from '../theme';
import { User } from '../types';
import { Avatar } from './Avatar';

const BIG = Math.min(Dimensions.get('window').width - 64, 320);

/**
 * A profile photo you can press and hold to see big, the way Instagram does
 * it: hold to look, let go to put it away.
 *
 * Letting go closes it. If the phone cancels the touch as the big photo
 * appears (iOS can, when a Modal opens under a finger), that early "let go"
 * is ignored and a tap anywhere closes it instead, so it never just flashes.
 */
export function AvatarPeek({ user, size }: { user?: User | null; size: number }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const openedAt = useRef(0);
  const scale = useRef(new Animated.Value(0.6)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    scale.setValue(0.6);
    fade.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 6 }),
      Animated.timing(fade, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
  }, [open, scale, fade]);

  const show = () => {
    openedAt.current = Date.now();
    setOpen(true);
  };
  // openedAt is 0 while closed, so a plain tap's release does nothing.
  const letGo = () => {
    if (openedAt.current && Date.now() - openedAt.current > 200) close();
  };
  const close = () => {
    openedAt.current = 0;
    setOpen(false);
  };

  return (
    <>
      <Pressable
        testID="avatar-peek"
        onLongPress={show}
        delayLongPress={250}
        onPressOut={letGo}
        accessibilityRole="imagebutton"
        accessibilityLabel="Profile photo. Press and hold to enlarge"
      >
        <Avatar user={user} size={size} />
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        {/* On the web the big photo takes the mouse-up (the browser sends it
            to whatever is under the pointer), so letting go is caught here too. */}
        <Pressable
          testID="avatar-peek-close"
          style={StyleSheet.absoluteFill}
          onPress={close}
          onPointerUp={letGo}
        >
          <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: fade }]} />
          <Animated.View
            testID="avatar-peek-big"
            style={[styles.center, { opacity: fade, transform: [{ scale }] }]}
            pointerEvents="none"
          >
            <Avatar user={user} size={BIG} />
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  dim: { backgroundColor: colors.overlay },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
}));
