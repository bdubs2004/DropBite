import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HASHTAG_GROUPS, MAX_HASHTAGS, normalizeHashtag, toggleHashtag } from '../lib/hashtags';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';

/**
 * The "Hashtags" sheet while writing a post: the list grouped by kind
 * (cuisine, diet, price, ...), tap to add, tap again to take off, up to
 * MAX_HASHTAGS. The box at the top narrows the list as you type.
 *
 * Like the Tag people sheet, it draws its own tap-outside-to-close area, so it
 * sits inside a transparent Modal.
 */
export function HashtagPicker({
  selected,
  onChangeSelected,
  onClose,
}: {
  selected: string[];
  onChangeSelected: (tags: string[]) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [full, setFull] = useState(false);

  const term = normalizeHashtag(query);
  const groups = HASHTAG_GROUPS.map((g) => ({
    ...g,
    tags: term ? g.tags.filter((t) => t.includes(term)) : g.tags,
  })).filter((g) => g.tags.length > 0);

  const toggle = (tag: string) => {
    const next = toggleHashtag(selected, tag);
    // Nothing changed while adding: already at the limit.
    setFull(next === selected && !selected.includes(tag));
    onChangeSelected(next);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <Pressable testID="hashtag-picker-backdrop" style={styles.backdrop} onPress={onClose} />
      <View
        testID="hashtag-picker"
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
      >
        <View style={styles.grabber} />
        <View style={styles.head}>
          <View>
            <Text style={styles.title}>Hashtags</Text>
            <Text testID="hashtag-count" style={[styles.count, full && { color: colors.danger }]}>
              {full
                ? `You can add up to ${MAX_HASHTAGS}`
                : `${selected.length} of ${MAX_HASHTAGS} · helps people find your dish`}
            </Text>
          </View>
          <Pressable testID="hashtag-picker-done" onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={colors.cocoaFaint} />
          <TextInput
            keyboardAppearance={colors.dark ? 'dark' : 'light'}
            testID="hashtag-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Search hashtags"
            placeholderTextColor={colors.cocoaFaint}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <ScrollView
          style={{ maxHeight: 380 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {groups.map((g) => (
            <View key={g.title} style={{ marginBottom: spacing.md }}>
              <Text style={styles.section}>{g.title}</Text>
              <View style={styles.wrap}>
                {g.tags.map((tag) => {
                  const on = selected.includes(tag);
                  return (
                    <Pressable
                      key={tag}
                      testID={`hashtag-option-${tag}`}
                      onPress={() => toggle(tag)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[
                        styles.chip,
                        on && styles.chipOn,
                        !on && selected.length >= MAX_HASHTAGS && { opacity: 0.45 },
                      ]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>#{tag}</Text>
                      {on ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {groups.length === 0 ? (
            <Text style={styles.empty}>No hashtag like that yet</Text>
          ) : null}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors, { shadow }) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
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
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.creamDark,
    marginBottom: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: { fontFamily: fonts.display, fontSize: 19, color: colors.cocoa },
  count: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 1 },
  done: { fontFamily: fonts.bold, fontSize: 15, color: colors.amberDark },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.semi,
    fontSize: 15,
    color: colors.cocoa,
    paddingVertical: 0,
  },
  section: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  chipText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoaSoft },
  chipTextOn: { color: colors.white },
  empty: {
    fontFamily: fonts.semi,
    fontSize: 13.5,
    color: colors.cocoaFaint,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
}));
