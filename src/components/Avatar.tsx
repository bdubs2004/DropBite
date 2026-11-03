import { Image } from 'expo-image';
import React from 'react';
import { Text, View } from 'react-native';
import { fonts, makeStyles, useColors } from '../theme';
import { User } from '../types';

function initials(name?: string | null): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}

/** A steady pick per person (same person, same colour every time). */
function pick(key: string, n: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

export function Avatar({ user, size = 44 }: { user?: User | null; size?: number }) {
  const styles = useStyles();
  const colors = useColors();
  const style = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };
  if (user?.avatar_url) {
    return (
      <Image
        source={{ uri: user.avatar_url }}
        style={[styles.img, style]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={120}
      />
    );
  }
  // People without a photo get one of a few colours rather than all the same
  // orange, so a list of them reads as different people.
  const tones = [
    { bg: colors.amber, fg: colors.onAmber },
    ...Object.values(colors.meal).map((m) => ({ bg: m.bg, fg: m.color })),
  ];
  const tone = tones[pick(user?.id ?? user?.handle ?? '', tones.length)];
  return (
    <View style={[styles.fallback, style, { backgroundColor: tone.bg }]}>
      <Text
        style={{
          fontFamily: fonts.display,
          fontSize: size * 0.38,
          color: tone.fg,
          letterSpacing: 0.5,
        }}
      >
        {initials(user?.display_name)}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  img: {
    backgroundColor: colors.creamDark,
  },
  fallback: {
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
