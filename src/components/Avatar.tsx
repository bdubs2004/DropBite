import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { User } from '../types';

export function Avatar({ user, size = 44 }: { user?: User | null; size?: number }) {
  const style = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };
  if (user?.avatar_url) {
    return <Image source={{ uri: user.avatar_url }} style={[styles.img, style]} />;
  }
  return (
    <View style={[styles.fallback, style]}>
      <Text style={{ fontSize: size * 0.52, lineHeight: size * 0.7 }}>
        {user?.avatar_emoji || '🍽️'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  img: {
    backgroundColor: colors.creamDark,
  },
  fallback: {
    backgroundColor: colors.creamDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.amberSoft,
  },
});
