import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, spacing } from '../theme';

/**
 * A small centred sheet for naming a group chat.
 *
 * Used from the chat header (tap the name) and the inbox (long-press a group).
 * Empty clears the custom name and falls back to the members' names, so it
 * doubles as "remove name". Kept deliberately tiny — one field, two buttons.
 */
export function RenameGroupSheet({
  visible,
  initial,
  onCancel,
  onSave,
}: {
  visible: boolean;
  initial: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initial);

  // Reset the field to the current name each time it opens.
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={[styles.card, { marginBottom: insets.bottom }]}>
          <Text style={styles.title}>Name this group</Text>
          <TextInput
            testID="group-name-input"
            value={text}
            onChangeText={setText}
            placeholder="Group name"
            placeholderTextColor={colors.cocoaFaint}
            style={styles.input}
            maxLength={60}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => onSave(text)}
          />
          <View style={styles.row}>
            <Pressable
              testID="group-name-cancel"
              onPress={onCancel}
              style={[styles.btn, styles.cancel]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="group-name-save"
              onPress={() => onSave(text)}
              style={[styles.btn, styles.save]}
            >
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fonts.semi,
    fontSize: 16,
    color: colors.cocoa,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  cancel: { backgroundColor: colors.creamDark },
  cancelText: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.cocoa },
  save: { backgroundColor: colors.amber },
  saveText: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.white },
});
