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
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  small?: boolean;
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

/** Recipe cards get a "bitten" top-right corner, the brand motif. */
export function BittenCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.card, styles.bittenCard, style]}>
      <View style={styles.biteCircleBig} />
      <View style={styles.biteCrumb1} />
      <View style={styles.biteCrumb2} />
      {children}
    </View>
  );
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
    overflow: 'hidden',
    backgroundColor: colors.cream,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
  },
  biteCircleBig: {
    position: 'absolute',
    top: -26,
    right: -14,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.white,
  },
  biteCrumb1: {
    position: 'absolute',
    top: 16,
    right: 22,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.amberSoft,
  },
  biteCrumb2: {
    position: 'absolute',
    top: 30,
    right: 12,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.amberSoft,
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
