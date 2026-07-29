import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  small,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  small?: boolean;
  testID?: string;
}) {
  const bg =
    variant === 'primary'
      ? colors.amber
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.creamDark
          : 'transparent';
  const fg =
    variant === 'primary' || variant === 'danger'
      ? colors.white
      : variant === 'secondary'
        ? colors.cocoa
        : colors.amberDark;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { paddingHorizontal: spacing.md },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnText, small && styles.btnTextSmall, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.cocoaFaint}
        {...rest}
        style={[styles.input, rest.multiline && styles.inputMultiline, style]}
      />
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Cream-toned card used for recipe cards. */
export function BittenCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, styles.bittenCard, style]}>{children}</View>;
}

export function ScreenTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.screenTitle}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  btnSmall: {
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    minHeight: 36,
  },
  btnText: {
    fontFamily: fonts.display,
    fontSize: 16,
    letterSpacing: 0.3,
  },
  btnTextSmall: {
    fontSize: 14,
  },
  label: {
    fontFamily: fonts.bold,
    color: colors.cocoaSoft,
    fontSize: 13,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: fonts.semi,
    color: colors.cocoa,
  },
  inputMultiline: {
    minHeight: 110,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...(shadowSoft as object),
  },
  bittenCard: {
    backgroundColor: colors.cream,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
  },
  screenTitle: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.cocoa,
  },
  muted: {
    fontFamily: fonts.semi,
    color: colors.cocoaFaint,
    fontSize: 13,
  },
});
