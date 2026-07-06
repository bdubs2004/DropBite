import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { Post } from '../types';

/**
 * Photo-first, always. Real posts show the actual photo; demo seed posts
 * use a warm gradient tile with a big food emoji so the feed looks alive
 * with zero network/API dependencies.
 */
const EMOJI_BG: Record<string, [string, string]> = {
  '🥞': ['#FDD79B', '#F2A65A'],
  '🍖': ['#E8A18B', '#B85C43'],
  '🍔': ['#F4C27A', '#D98E3B'],
  '🥗': ['#C9E4A5', '#8DBF62'],
  '🥘': ['#F2B979', '#CE7940'],
  '🍪': ['#E7C9A1', '#B78B5C'],
  '🍜': ['#F5D9A0', '#DBA858'],
  '🌽': ['#F7E08E', '#E3B93E'],
  '🌮': ['#F3C583', '#D68F45'],
  '🧇': ['#F1CE93', '#CE9E52'],
};

export function PostPhoto({ post, ratio = 1.15 }: { post: Post; ratio?: number }) {
  if (post.photo_url) {
    return (
      <Image
        source={{ uri: post.photo_url }}
        style={[styles.photo, { aspectRatio: 1 / ratio }]}
        resizeMode="cover"
      />
    );
  }
  const emoji = post.photo_emoji || '🍽️';
  const [top, bottom] = EMOJI_BG[emoji] ?? ['#F5D9A0', '#DBA858'];
  return (
    <View style={[styles.photo, styles.tile, { aspectRatio: 1 / ratio, backgroundColor: top }]}>
      {/* fake vertical gradient with an overlay band */}
      <View style={[styles.gradBottom, { backgroundColor: bottom }]} />
      <View style={[styles.blob, { backgroundColor: bottom, opacity: 0.35 }]} />
      <Text style={styles.emoji}>{emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: '100%',
    backgroundColor: colors.creamDark,
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  gradBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
    opacity: 0.55,
    borderTopLeftRadius: 200,
    borderTopRightRadius: 200,
    transform: [{ scaleX: 1.6 }],
  },
  blob: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -60,
    right: -60,
  },
  emoji: {
    fontSize: 96,
    textShadowColor: 'rgba(74,46,18,0.18)',
    textShadowOffset: { width: 0, height: 6 },
    textShadowRadius: 12,
  },
});
