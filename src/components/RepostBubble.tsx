import { Ionicons } from '@expo/vector-icons';
import React, { useRef } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';
import { fonts, makeStyles, useColors } from '../theme';
import { User } from '../types';
import { Avatar } from './Avatar';

const PAD = 10;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Floating "reposted" bubble that sits over a post's photo (bottom-left) and
 * can be dragged anywhere on the photo. Shows the reposters' profile pics
 * stacked, with the name (one) or a count (several). Tapping — as opposed to
 * dragging — opens the first reposter's profile.
 *
 * `containerW/H` are the photo's measured size, used to keep the bubble from
 * being dragged off the image.
 */
export function RepostBubble({
  reposters,
  containerW,
  containerH,
  onPressUser,
  lift = 0,
}: {
  reposters: User[];
  containerW: number;
  containerH: number;
  onPressUser?: (userId: string) => void;
  /** Start this much higher (the photo's tag dot sits in the corner). */
  lift?: number;
}) {
  const styles = useStyles();
  const colors = useColors();
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const start = useRef({ x: 0, y: 0 });
  const size = useRef({ w: 0, h: 0 });
  const moved = useRef(false);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        moved.current = false;
        pan.stopAnimation((v) => {
          start.current = v;
        });
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3) moved.current = true;
        // Anchored bottom-left: x grows rightward (0..), y shrinks upward (..0).
        const maxX = Math.max(0, containerW - size.current.w - PAD * 2);
        const minY = -Math.max(0, containerH - size.current.h - PAD * 2 - lift);
        pan.setValue({
          x: clamp(start.current.x + g.dx, 0, maxX),
          y: clamp(start.current.y + g.dy, minY, 0),
        });
      },
      onPanResponderRelease: () => {
        if (!moved.current) onPressUser?.(reposters[0]?.id);
      },
    }),
  ).current;

  if (!reposters.length) return null;
  const shown = reposters.slice(0, 3);
  const label =
    reposters.length === 1
      ? `${reposters[0].display_name ?? 'Someone'} reposted`
      : `${reposters.length} reposted`;

  return (
    <Animated.View
      testID="post-repost-bubble"
      {...responder.panHandlers}
      onLayout={(e) => {
        size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
      }}
      style={[
        styles.bubble,
        lift ? { bottom: PAD + lift } : null,
        { transform: pan.getTranslateTransform() },
      ]}
    >
      <Ionicons name="repeat" size={13} color={colors.white} />
      <View style={styles.avatars}>
        {shown.map((u, i) => (
          <View key={u.id} style={[styles.avatarWrap, i > 0 && { marginLeft: -8 }]}>
            <Avatar user={u} size={18} />
          </View>
        ))}
      </View>
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  bubble: {
    position: 'absolute',
    left: PAD,
    bottom: PAD,
    maxWidth: '85%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.overlay,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: {
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  text: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.white,
    letterSpacing: 0.2,
  },
}));
