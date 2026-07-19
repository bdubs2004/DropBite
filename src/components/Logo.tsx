import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

/** The nibl fork-bubble mark. */
export function LogoMark({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/nibl-mark.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}

/** Mark + wordmark row for headers. */
export function LogoLockup({ height = 34 }: { height?: number }) {
  return (
    <View style={styles.row}>
      <LogoMark size={height} />
      <Text style={[styles.word, { fontSize: height * 0.72, marginLeft: 8 }]}>nibl</Text>
    </View>
  );
}

export function Wordmark({ size = 30, color = colors.cocoa }: { size?: number; color?: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.word, { fontSize: size, color }]}>nibl</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  word: {
    fontFamily: fonts.wordmark,
    color: colors.cocoa,
    letterSpacing: -0.5,
  },
});
