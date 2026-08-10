import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { pickImage } from '../lib/pickImage';
import { colors, fonts, radius, shadow, spacing } from '../theme';
import { User } from '../types';
import { Avatar } from './Avatar';

/**
 * Tappable profile picture with a "+" badge.
 *
 * Tapping offers Camera or Library (native gets an action sheet, web an inline
 * pair of buttons, since Alert.alert is a no-op under react-native-web). The
 * chosen image is cropped square, downscaled, and handed to onPick, which
 * uploads it.
 */
export function AvatarPicker({
  user,
  onPick,
  size = 104,
}: {
  user?: User | null;
  onPick: (localUri: string) => Promise<void>;
  size?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  const run = async (fromCamera: boolean) => {
    setChoosing(false);
    setError(null);
    const res = await pickImage({ fromCamera, aspect: [1, 1], width: 512 });
    if (res.error) {
      setError(res.error);
      return;
    }
    if (!res.uri) return; // cancelled
    setBusy(true);
    try {
      await onPick(res.uri);
    } catch {
      setError('Could not save that photo. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const open = () => {
    if (busy) return;
    if (Platform.OS === 'web') {
      setChoosing((v) => !v);
      return;
    }
    Alert.alert('Profile photo', 'Choose a new picture', [
      { text: 'Take photo', onPress: () => run(true) },
      { text: 'Choose from library', onPress: () => run(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        testID="avatar-picker"
        onPress={open}
        disabled={busy}
        accessibilityLabel="Change profile photo"
        style={({ pressed }) => [styles.ring, pressed && { opacity: 0.85 }]}
      >
        {/* Amber ring reads as an affordance, not just decoration. */}
        <View style={[styles.ringInner, { width: size, height: size, borderRadius: size / 2 }]}>
          <Avatar user={user} size={size - 8} />
          {busy ? (
            <View style={[styles.busy, { borderRadius: (size - 8) / 2 }]}>
              <ActivityIndicator color={colors.white} />
            </View>
          ) : null}
        </View>
        <View style={styles.plusBadge}>
          <Ionicons name="add" size={20} color={colors.white} />
        </View>
      </Pressable>

      <Text style={styles.hint}>{busy ? 'Uploading' : 'Tap to change your photo'}</Text>

      {choosing ? (
        <View style={styles.chooser}>
          <Pressable testID="avatar-camera" style={styles.chooserBtn} onPress={() => run(true)}>
            <Ionicons name="camera" size={18} color={colors.amberDark} />
            <Text style={styles.chooserText}>Camera</Text>
          </Pressable>
          <Pressable testID="avatar-library" style={styles.chooserBtn} onPress={() => run(false)}>
            <Ionicons name="image" size={18} color={colors.amberDark} />
            <Text style={styles.chooserText}>Library</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text testID="avatar-error" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.amber,
    backgroundColor: colors.cream,
    ...(shadow as object),
  },
  busy: {
    ...StyleSheet.absoluteFillObject,
    margin: 4,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.white,
    ...(shadow as object),
  },
  hint: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.cocoaFaint,
    marginTop: spacing.md,
  },
  chooser: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chooserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.cream,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  chooserText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.amberDark,
  },
  error: {
    fontFamily: fonts.semi,
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
    marginTop: spacing.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
