import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { fonts, makeStyles } from '../theme';
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
  onLongPress,
  style,
  radius = 0,
}: {
  post: Post;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
  radius?: number;
}) {
  const styles = useStyles();
  const emoji = post.photo_emoji || '🍽️';
  const tone = TILE_TONES[emoji] ?? '#A98A62';

  const content = (
    <>
      {post.photo_url ? (
        <Image
          source={{ uri: post.photo_url }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
          contentFit="cover"
          // Disk+memory cache so a thumb loads instantly the second time, and
          // decodes off the main thread. recyclingKey stops a recycled grid
          // cell from briefly showing the previous photo while the new loads.
          cachePolicy="memory-disk"
          recyclingKey={post.id}
          transition={120}
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
    </>
  );

  // With nothing to do on a tap, a plain View, so the tap reaches whatever
  // the tile sits in (an Activity row, a shared post in a DM). A Pressable
  // with no onPress still takes the touch and swallows it.
  if (!onPress && !onLongPress) {
    return (
      <View testID={`thumb-${post.id}`} style={[styles.tile, { borderRadius: radius }, style]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={`thumb-${post.id}`}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      style={({ pressed }) => [
        styles.tile,
        { borderRadius: radius },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
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
}));
