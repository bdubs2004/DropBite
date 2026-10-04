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
 * A small centred sheet for naming something: one field, two buttons.
 *
 * Defaults to naming a group chat, used from the chat header (tap the name)
 * and the inbox (long-press a group); there an empty name clears the custom
 * one and falls back to the members' names. Collections use it too, with
 * their own title, placeholder and an `error` line for a name that's taken.
 */
export function RenameGroupSheet({
  visible,
  initial,
  onCancel,
  onSave,
  title = 'Name this group',
  placeholder = 'Group name',
  maxLength = 60,
  saveLabel = 'Save',
  error,
  testIDPrefix = 'group-name',
}: {
  visible: boolean;
  initial: string;
  onCancel: () => void;
  onSave: (name: string) => void;
  title?: string;
  placeholder?: string;
  maxLength?: number;
  saveLabel?: string;
  error?: string | null;
  testIDPrefix?: string;
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
          <Text style={styles.title}>{title}</Text>
          <TextInput
            testID={`${testIDPrefix}-input`}
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={colors.cocoaFaint}
            style={styles.input}
            maxLength={maxLength}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => onSave(text)}
          />
          {error ? (
            <Text testID={`${testIDPrefix}-error`} style={styles.error}>
              {error}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable
              testID={`${testIDPrefix}-cancel`}
              onPress={onCancel}
              style={[styles.btn, styles.cancel]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID={`${testIDPrefix}-save`}
              onPress={() => onSave(text)}
              style={[styles.btn, styles.save]}
            >
              <Text style={styles.saveText}>{saveLabel}</Text>
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
  error: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.danger,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  cancel: { backgroundColor: colors.creamDark },
  cancelText: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.cocoa },
  save: { backgroundColor: colors.amber },
  saveText: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.white },
});
