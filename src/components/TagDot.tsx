import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { User } from '../types';

const DOT = 30;

/**
 * The little tag dot in the bottom-left of a photo that has people tagged in
 * it. Tap it and a strip rolls out to the right naming who's tagged; each
 * name opens that profile. Tap the dot again to roll it back in.
 *
 * `maxWidth` is the room on the photo, so a long list scrolls sideways rather
 * than running off the picture.
 */
export function TagDot({
  tagged,
  maxWidth,
  onPressUser,
}: {
  tagged: User[];
  maxWidth: number;
  onPressUser?: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const roll = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    Animated.timing(roll, {
      toValue: next ? 1 : 0,
      duration: next ? 260 : 180,
      easing: next ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      // Animates a width, which the native driver can't do.
      useNativeDriver: false,
    }).start();
  };

  // How wide the names are, measured off-screen, so the strip rolls out to
  // exactly fit them (or the photo's width, scrolling past that).
  const [namesWidth, setNamesWidth] = useState(0);
  const room = Math.max(0, maxWidth - DOT - 6);
  const target = Math.min(namesWidth, room);
  const width = roll.interpolate({ inputRange: [0, 1], outputRange: [0, target] });

  const names = tagged.map((u, i) => (
    <View key={u.id} style={styles.nameRow}>
      {i > 0 ? <Text style={styles.sep}>·</Text> : null}
      <Pressable
        testID={`post-tag-name-${u.id}`}
        onPress={() => onPressUser?.(u.id)}
        hitSlop={6}
        disabled={!open}
      >
        <Text style={styles.name} numberOfLines={1}>
          {u.display_name}
        </Text>
      </Pressable>
    </View>
  ));

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        testID="post-tag-dot"
        onPress={toggle}
        hitSlop={8}
        style={styles.dot}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide who is tagged' : `${tagged.length} tagged`}
        accessibilityState={{ expanded: open }}
      >
        <Ionicons name="pricetag" size={14} color={colors.white} />
      </Pressable>
      <Animated.View
        testID="post-tag-strip"
        style={[styles.strip, { width, opacity: roll }]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <ScrollView
          horizontal
          style={{ width: target }}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.names}
        >
          {names}
        </ScrollView>
      </Animated.View>

      {/* Invisible copy, only to measure how wide the names are. */}
      <View
        style={[styles.names, styles.measure]}
        pointerEvents="none"
        onLayout={(e) => setNamesWidth(Math.ceil(e.nativeEvent.layout.width))}
      >
        {tagged.map((u, i) => (
          <View key={u.id} style={styles.nameRow}>
            {i > 0 ? <Text style={styles.sep}>·</Text> : null}
            <Text style={styles.name} numberOfLines={1}>
              {u.display_name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: 'rgba(42, 26, 10, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: {
    marginLeft: 6,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: 'rgba(42, 26, 10, 0.72)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  names: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  measure: { position: 'absolute', left: 0, top: 0, opacity: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  sep: { color: 'rgba(255,255,255,0.6)', marginHorizontal: 6, fontFamily: fonts.bold },
  name: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
