import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, shadow, spacing } from '../theme';

export type SheetAction = {
  key: string;
  label: string;
  icon: any;
  onPress: () => void;
  /** Renders in red and is the action people regret; put it last. */
  destructive?: boolean;
  /** Optional second line explaining what the action does. */
  hint?: string;
};

/**
 * Bottom action sheet.
 *
 * Used for every "…" / long-press menu in the app. Built on a plain Modal
 * rather than Alert.alert or an OS action sheet because Alert.alert is a
 * no-op under react-native-web and the OS sheets look different on each
 * platform; this renders and behaves identically everywhere.
 */
export function ActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallow taps inside the sheet so it doesn't dismiss itself. */}
        <Pressable
          testID="action-sheet"
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
          onPress={() => {}}
        >
          <View style={styles.grabber} />
          {title ? <Text style={styles.title}>{title}</Text> : null}

          {actions.map((a) => (
            <Pressable
              key={a.key}
              testID={`sheet-${a.key}`}
              onPress={() => {
                // Close first so the sheet is gone before any confirm dialog
                // or navigation the action triggers.
                onClose();
                a.onPress();
              }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={[styles.iconWrap, a.destructive && styles.iconWrapDanger]}>
                <Ionicons
                  name={a.icon}
                  size={19}
                  color={a.destructive ? colors.danger : colors.amberDark}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, a.destructive && { color: colors.danger }]}>
                  {a.label}
                </Text>
                {a.hint ? <Text style={styles.hint}>{a.hint}</Text> : null}
              </View>
            </Pressable>
          ))}

          <Pressable testID="sheet-cancel" onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    ...(shadow as object),
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.creamDark,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.cocoaSoft,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowPressed: { opacity: 0.7 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapDanger: { backgroundColor: 'rgba(201, 79, 46, 0.12)' },
  label: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  hint: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 1 },
  cancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: 2,
  },
  cancelText: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoaSoft },
});
