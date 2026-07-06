import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

/** The bitten-drop lockup for headers. */
export function LogoLockup({ height = 34 }: { height?: number }) {
  return (
    <Image
      source={require('../../assets/logo-lockup.png')}
      style={{ height, width: height * 3.05 }}
      resizeMode="contain"
    />
  );
}

export function LogoMark({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/drop-mark.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}

export function Wordmark({ size = 30, color = colors.cocoa }: { size?: number; color?: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.word, { fontSize: size, color }]}>dropbite</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  word: {
    fontFamily: fonts.display,
    letterSpacing: -0.5,
  },
});
