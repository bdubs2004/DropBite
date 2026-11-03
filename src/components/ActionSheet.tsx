import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';

export type SheetAction = {
  key: string;
  label: string;
  icon: any;
  onPress: () => void;
  /** Renders in red and is the action people regret; put it last. */
  destructive?: boolean;
  /** Not shown: an action's name says what it does, as in any app's menu. */
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
  header,
}: {
  visible: boolean;
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
  /** Extra content above the actions (the emoji row on a chat message). */
  header?: React.ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallow taps inside the sheet so it doesn't dismiss itself. */}
        <Pressable
          testID="action-sheet"
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
          onPress={() => {}}
        >
          <View style={styles.grabber} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {header}

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
              <Ionicons
                name={a.icon}
                size={22}
                color={a.destructive ? colors.danger : colors.cocoa}
              />
              <Text style={[styles.label, a.destructive && { color: colors.danger }]}>
                {a.label}
              </Text>
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

const useStyles = makeStyles((colors, { shadow }) => ({
  // No dim: the screen behind stays exactly as it was. This full-screen
  // layer is only there so a tap outside the sheet closes it; the sheet's own
  // shadow is what sets it apart.
  backdrop: { flex: 1, justifyContent: 'flex-end' },
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
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: spacing.xs,
  },
  rowPressed: { opacity: 0.6 },
  label: { flex: 1, fontFamily: fonts.semi, fontSize: 16, color: colors.cocoa },
  cancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  cancelText: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoaSoft },
}));
