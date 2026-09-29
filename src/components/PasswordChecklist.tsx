import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { passwordChecks } from '../lib/passwordRules';
import { colors, fonts, spacing } from '../theme';

/**
 * Live password requirement checklist. Each rule ticks green the moment the
 * typed password satisfies it, so people can see exactly what's missing instead
 * of guessing after a rejected submit.
 */
export function PasswordChecklist({ password }: { password: string }) {
  return (
    <View style={styles.list} testID="password-checklist">
      {passwordChecks(password).map((c) => (
        <View key={c.key} style={styles.row}>
          <Ionicons
            name={c.met ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={c.met ? colors.success : colors.cocoaFaint}
          />
          <Text style={[styles.label, c.met && styles.labelMet]}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.sm, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { fontFamily: fonts.semi, fontSize: 13, color: colors.cocoaFaint },
  labelMet: { fontFamily: fonts.bold, color: colors.success },
});
