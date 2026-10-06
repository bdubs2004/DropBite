import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
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
  textStyle,
  small,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  /** Overrides the label colour/typography, e.g. to tint a custom-filled button. */
  textStyle?: TextStyle;
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
        <ActivityIndicator color={textStyle?.color ?? fg} />
      ) : (
        <Text style={[styles.btnText, small && styles.btnTextSmall, { color: fg }, textStyle]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * Text field. Forwards its ref so a screen can focus it (Search does).
 *
 * A multiline field grows with its text instead of scrolling inside itself.
 * On iPhone a scrolling text box swallows the swipe, so starting a scroll on
 * the description or bio would move nothing; this way the page scrolls no
 * matter where your finger lands. Pass scrollEnabled to opt back in.
 */
export const Input = React.forwardRef<TextInput, TextInputProps & { label?: string }>(
  function Input(props, ref) {
    const { label, style, secureTextEntry, ...rest } = props;
    // The browser's text box doesn't grow by itself like iOS's does, so grow
    // it by hand on web (otherwise it turns into a little scroll box again).
    const growOnWeb = Platform.OS === 'web' && !!rest.multiline && rest.scrollEnabled === undefined;
    const [webHeight, setWebHeight] = React.useState(0);
    // Password boxes get an eye on the right to show or hide what you typed.
    const [revealed, setRevealed] = React.useState(false);
    const hideable = !!secureTextEntry;
    return (
      <View style={{ marginBottom: spacing.md }}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <View>
          <TextInput
            ref={ref}
            placeholderTextColor={colors.cocoaFaint}
            scrollEnabled={rest.multiline ? false : undefined}
            secureTextEntry={hideable && !revealed}
            {...rest}
            onContentSizeChange={(e) => {
              // Ignore 1px wobbles: the browser rounds the content height up,
              // and chasing that would resize the box forever.
              const h = Math.ceil(e.nativeEvent.contentSize.height);
              if (growOnWeb) setWebHeight((prev) => (Math.abs(h - prev) > 1 ? h : prev));
              rest.onContentSizeChange?.(e);
            }}
            style={[
              styles.input,
              rest.multiline && styles.inputMultiline,
              style,
              // + the 1.5px top and bottom border, which the content size leaves out.
              growOnWeb && webHeight ? { height: webHeight + 3, overflow: 'hidden' } : null,
              hideable ? styles.inputWithEye : null,
            ]}
          />
          {hideable ? (
            <Pressable
              testID={rest.testID ? `${rest.testID}-eye` : 'password-eye'}
              onPress={() => setRevealed((v) => !v)}
              hitSlop={8}
              style={styles.eye}
              accessibilityRole="button"
              accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            >
              <Ionicons
                name={revealed ? 'eye-off-outline' : 'eye-outline'}
                size={21}
                color={colors.cocoaSoft}
              />
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  },
);

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
  // Room on the right for the show/hide eye, so text never runs under it.
  inputWithEye: { paddingRight: 48 },
  eye: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
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
