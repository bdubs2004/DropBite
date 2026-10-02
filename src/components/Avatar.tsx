import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { User } from '../types';

function initials(name?: string | null): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}

export function Avatar({ user, size = 44 }: { user?: User | null; size?: number }) {
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
  return (
    <View style={[styles.fallback, style]}>
      <Text
        style={{
          fontFamily: fonts.display,
          fontSize: size * 0.38,
          color: colors.white,
          letterSpacing: 0.5,
        }}
      >
        {initials(user?.display_name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  img: {
    backgroundColor: colors.creamDark,
  },
  fallback: {
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
