import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTime, timeOptions } from '../lib/mealTimes';
import { colors, fonts, radius, spacing } from '../theme';

/**
 * Pick a time of day.
 *
 * Deliberately a plain scrolling list rather than @react-native-community/
 * datetimepicker: that package has no usable web support, and NiblGo runs on web
 * as well as in Expo Go. A 15-minute list is the right granularity for "remind
 * me around dinner" and behaves identically on every platform.
 */
export function TimePickerModal({
  visible,
  value,
  title,
  onSelect,
  onClose,
}: {
  visible: boolean;
  /** Current "HH:MM", used to preselect and scroll into view. */
  value: string;
  title: string;
  onSelect: (next: string) => void;
  onClose: () => void;
}) {
  const options = useMemo(() => timeOptions(15), []);
  const listRef = useRef<FlatList<string>>(null);
  const selectedIndex = Math.max(0, options.indexOf(value));

  // Open on the current time rather than at midnight.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: selectedIndex,
        animated: false,
        viewPosition: 0.5,
      });
    }, 50);
    return () => clearTimeout(t);
  }, [visible, selectedIndex]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop taps inside the sheet from closing it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable testID="time-picker-close" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.cocoaSoft} />
            </Pressable>
          </View>

          <FlatList
            ref={listRef}
            data={options}
            keyExtractor={(t) => t}
            initialNumToRender={24}
            getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
            onScrollToIndexFailed={() => {}}
            style={{ maxHeight: 340 }}
            renderItem={({ item }) => {
              const active = item === value;
              return (
                <Pressable
                  testID={`time-option-${item}`}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  style={[styles.row, active && styles.rowActive]}
                >
                  <Text style={[styles.rowText, active && styles.rowTextActive]}>
                    {formatTime(item)}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={19} color={colors.amberDark} />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const ROW_HEIGHT = 48;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    width: '100%',
    maxWidth: 360,
    paddingBottom: spacing.sm,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.cocoa,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  rowActive: {
    backgroundColor: colors.cream,
  },
  rowText: {
    fontFamily: fonts.semi,
    fontSize: 16,
    color: colors.cocoa,
  },
  rowTextActive: {
    fontFamily: fonts.bold,
    color: colors.amberDark,
  },
});
