import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, fonts } from '../theme';
import { Post } from '../types';

/**
 * Square photo tile for the Discover grid and the mini-profile strips.
 *
 * Mirrors PostPhoto's fallback: demo seed posts have no real photo, so they
 * get the same emoji-on-tone tile rather than an empty square.
 */
const TILE_TONES: Record<string, string> = {
  '🥞': '#C99B62', '🍖': '#9E5B48', '🍔': '#B0793C', '🥗': '#7E9159',
  '🥘': '#B06E3D', '🍪': '#A98A62', '🍜': '#BC9455', '🌽': '#B9A04B',
  '🌮': '#AD7A45', '🧇': '#B18E55', '🍳': '#C0975B', '🥪': '#A98E5B',
  '🍲': '#9C6247', '🍿': '#B49C58', '🍝': '#AC6E4A', '🥩': '#9D5847',
  '🍣': '#A08159', '🥧': '#B0854E',
};

export function PostThumb({
  post,
  onPress,
  style,
  radius = 0,
}: {
  post: Post;
  onPress?: () => void;
  style?: ViewStyle;
  radius?: number;
}) {
  const emoji = post.photo_emoji || '🍽️';
  const tone = TILE_TONES[emoji] ?? '#A98A62';

  return (
    <Pressable
      testID={`thumb-${post.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { borderRadius: radius },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {post.photo_url ? (
        <Image
          source={{ uri: post.photo_url }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
          resizeMode="cover"
        />
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.fallback,
            { backgroundColor: tone, borderRadius: radius },
          ]}
        >
          <Text style={styles.emoji}>{emoji}</Text>
        </View>
      )}
      {post.recipe ? (
        // Marks posts that carry a recipe card, so the grid reads as more than
        // pictures — recipes are the thing worth discovering.
        <View style={styles.recipeBadge}>
          <Text style={styles.recipeBadgeText}>Recipe</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    aspectRatio: 1,
    backgroundColor: colors.creamDark,
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 34,
  },
  recipeBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    backgroundColor: colors.overlay,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  recipeBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.white,
    letterSpacing: 0.3,
  },
});
