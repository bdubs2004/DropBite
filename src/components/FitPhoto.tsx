import { Image } from 'expo-image';
import React, { useState } from 'react';
import { ImageStyle, StyleProp } from 'react-native';
import { photoFrame } from '../lib/photoFrame';

/**
 * A photo at a fixed width and its own shape: a DM photo, a photo in a
 * comment. Starts 4:5, then takes the photo's real shape once it loads (see
 * lib/photoFrame), so a whole camera shot shows uncropped.
 */
export function FitPhoto({
  uri,
  width,
  style,
  testID,
}: {
  uri: string;
  width: number;
  style?: StyleProp<ImageStyle>;
  testID?: string;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const frame = photoFrame(size?.w, size?.h);
  return (
    <Image
      testID={testID}
      source={{ uri }}
      style={[style, { width, height: Math.round(width * frame.ratio) }]}
      contentFit={frame.fit}
      cachePolicy="memory-disk"
      transition={120}
      onLoad={(e) => {
        const { width: w, height: h } = e.source ?? {};
        if (w && h) setSize({ w, h });
      }}
    />
  );
}
