import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { photoFrame } from '../lib/photoFrame';
import { useIsZoomCopy } from './PinchZoom';
import { makeStyles } from '../theme';
import { Post } from '../types';

/**
 * Photo-first, always. Real posts show the actual photo; demo seed posts use
 * a muted placeholder tile (posts you create use your real camera photos).
 */
const TILE_TONES: Record<string, [string, string]> = {
  '🥞': ['#C99B62', '#A87A44'],
  '🍖': ['#9E5B48', '#7E4235'],
  '🍔': ['#B0793C', '#8F5E2B'],
  '🥗': ['#7E9159', '#617442'],
  '🥘': ['#B06E3D', '#8E552C'],
  '🍪': ['#A98A62', '#87694A'],
  '🍜': ['#BC9455', '#99763F'],
  '🌽': ['#B9A04B', '#968036'],
  '🌮': ['#AD7A45', '#8B5F32'],
  '🧇': ['#B18E55', '#8F6F3E'],
  '🍳': ['#C0975B', '#9C7742'],
  '🥪': ['#A98E5B', '#877043'],
  '🍲': ['#9C6247', '#7C4A34'],
  '🍿': ['#B49C58', '#927D41'],
  '🍝': ['#AC6E4A', '#8A5336'],
  '🥩': ['#9D5847', '#7C4034'],
  '🍣': ['#A08159', '#7F6441'],
  '🥧': ['#B0854E', '#8D6839'],
};

/**
 * Shapes measured for photos without a stored size (older posts), so the same
 * photo drawn again (the copy shown while you pinch it, the post in another
 * list) starts at the right shape instead of 4:5 and then jumping.
 */
const measuredSizes = new Map<string, { w: number; h: number }>();

/**
 * The whole photo at its own shape (see lib/photoFrame): the post's stored
 * size when it has one, so the feed lays out right before the photo loads;
 * measured on load for older posts. Pass `ratio` (height / width) only for a
 * fixed-shape crop, like a small cover tile.
 */
export function PostPhoto({
  post,
  ratio,
  maxRatio,
}: {
  post: Post;
  /** Force this frame (height / width) and crop to fill it. */
  ratio?: number;
  /** Cap how tall the frame can get; the photo fits inside, never cut. */
  maxRatio?: number;
}) {
  const styles = useStyles();
  const isZoomCopy = useIsZoomCopy();
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    () => (post.photo_url ? measuredSizes.get(post.photo_url) ?? null : null),
  );
  const known = post.photo_width && post.photo_height;
  const natural = photoFrame(
    known ? post.photo_width : measured?.w,
    known ? post.photo_height : measured?.h,
  );
  const frame =
    ratio !== undefined
      ? { ratio, fit: 'cover' as const }
      : maxRatio !== undefined && natural.ratio > maxRatio
        ? { ratio: maxRatio, fit: 'contain' as const }
        : natural;

  if (post.photo_url) {
    return (
      <Image
        testID="post-photo"
        source={{ uri: post.photo_url }}
        style={[styles.photo, { aspectRatio: 1 / frame.ratio }]}
        contentFit={frame.fit}
        cachePolicy="memory-disk"
        // The zoom copy must be there instantly: a fade-in would blink the
        // photo every time a pinch starts.
        transition={isZoomCopy ? 0 : 150}
        onLoad={
          known || ratio !== undefined
            ? undefined
            : (e) => {
                const { width, height } = e.source ?? {};
                if (!width || !height) return;
                if (post.photo_url) measuredSizes.set(post.photo_url, { w: width, h: height });
                setMeasured({ w: width, h: height });
              }
        }
      />
    );
  }
  const tileRatio = ratio ?? 1.15;
  const emoji = post.photo_emoji || '🍽️';
  const [base, deep] = TILE_TONES[emoji] ?? ['#A98A62', '#87694A'];
  return (
    <View style={[styles.photo, styles.tile, { aspectRatio: 1 / tileRatio, backgroundColor: base }]}>
      <View style={[styles.shade, { backgroundColor: deep }]} />
      <View style={styles.plate}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>
      <Text style={styles.placeholderNote}>Sample photo</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  photo: {
    width: '100%',
    backgroundColor: colors.creamDark,
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  shade: {
    position: 'absolute',
    left: -80,
    right: -80,
    bottom: -140,
    height: '65%',
    opacity: 0.5,
    borderTopLeftRadius: 400,
    borderTopRightRadius: 400,
  },
  plate: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: 'rgba(255, 244, 222, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 58,
  },
  placeholderNote: {
    position: 'absolute',
    bottom: 12,
    right: 14,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: 'rgba(255, 244, 222, 0.75)',
    letterSpacing: 0.4,
  },
}));
