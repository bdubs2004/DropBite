import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  ALL_HASHTAGS,
  HASHTAG_GROUPS,
  MAX_HASHTAGS,
  normalizeHashtag,
  toggleHashtag,
} from '../lib/hashtags';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';

/**
 * The Hashtags area of a new post, on the page itself rather than in a
 * popup: what you've picked (tap to take off), then the list to pick from
 * (HashtagBrowser). Up to MAX_HASHTAGS.
 */
export function HashtagField({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [full, setFull] = useState(false);

  const toggle = (tag: string) => {
    const next = toggleHashtag(selected, tag);
    // Nothing changed while adding: already at the limit.
    setFull(next === selected && !selected.includes(tag));
    onChange(next);
  };

  return (
    <View testID="hashtag-field" style={styles.card}>
      <View style={styles.picked}>
        {selected.length ? (
          selected.map((tag) => (
            <Pressable
              key={tag}
              testID={`hashtag-picked-${tag}`}
              onPress={() => toggle(tag)}
              style={[styles.chip, styles.chipOn]}
              accessibilityLabel={`Remove #${tag}`}
            >
              <Text style={[styles.chipText, styles.chipTextOn]}>#{tag}</Text>
              <Ionicons name="close" size={14} color={colors.white} />
            </Pressable>
          ))
        ) : (
          <Text style={styles.none}>Pick up to {MAX_HASHTAGS} so people can find your dish</Text>
        )}
      </View>
      {selected.length || full ? (
        <Text testID="hashtag-count" style={[styles.count, full && { color: colors.danger }]}>
          {full ? `You can add up to ${MAX_HASHTAGS}` : `${selected.length} of ${MAX_HASHTAGS}`}
        </Text>
      ) : null}

      <HashtagBrowser
        selected={selected}
        onToggle={toggle}
        dimOthers={selected.length >= MAX_HASHTAGS}
      />
    </View>
  );
}

/**
 * The hashtag list to pick from: a box to find a tag across every group, or
 * one group at a time (Cuisine, Diet, Cooking, Vibe). Used by a new post's
 * Hashtags area and by the Hashtags filter in Search.
 */
export function HashtagBrowser({
  selected,
  onToggle,
  dimOthers = false,
}: {
  selected: string[];
  onToggle: (tag: string) => void;
  /** Fade the tags not picked (no room for more). */
  dimOthers?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [group, setGroup] = useState(HASHTAG_GROUPS[0].title);
  const [query, setQuery] = useState('');

  const term = normalizeHashtag(query);
  // Typing searches every group; otherwise one group at a time.
  const options = term
    ? ALL_HASHTAGS.filter((t) => t.includes(term))
    : HASHTAG_GROUPS.find((g) => g.title === group)?.tags ?? [];

  return (
    <View>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={colors.cocoaFaint} />
        <TextInput
          keyboardAppearance={colors.dark ? 'dark' : 'light'}
          testID="hashtag-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Find a hashtag"
          placeholderTextColor={colors.cocoaFaint}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={17} color={colors.cocoaFaint} />
          </Pressable>
        ) : null}
      </View>

      {!term ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.groups}
          style={styles.groupScroll}
        >
          {HASHTAG_GROUPS.map((g) => {
            const on = g.title === group;
            return (
              <Pressable
                key={g.title}
                testID={`hashtag-group-${g.title.toLowerCase()}`}
                onPress={() => setGroup(g.title)}
                style={[styles.group, on && styles.groupOn]}
              >
                <Text style={[styles.groupText, on && styles.groupTextOn]}>{g.title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.wrap}>
        {options.map((tag) => {
          const on = selected.includes(tag);
          return (
            <Pressable
              key={tag}
              testID={`hashtag-option-${tag}`}
              onPress={() => onToggle(tag)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.chip,
                on && styles.chipOn,
                !on && dimOthers && { opacity: 0.45 },
              ]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>#{tag}</Text>
              {on ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
            </Pressable>
          );
        })}
        {options.length === 0 ? (
          <Text style={styles.none}>No hashtag like that yet</Text>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  picked: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, minHeight: 34, alignItems: 'center' },
  none: { fontFamily: fonts.semi, fontSize: 14, color: colors.cocoaFaint },
  count: {
    fontFamily: fonts.semi,
    fontSize: 12.5,
    color: colors.cocoaFaint,
    marginTop: spacing.xs,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.cream,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    marginTop: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.semi,
    fontSize: 15,
    color: colors.cocoa,
    paddingVertical: 0,
  },
  groupScroll: { marginHorizontal: -spacing.md, marginTop: spacing.md },
  groups: { gap: 6, paddingHorizontal: spacing.md },
  group: {
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 6,
    backgroundColor: colors.cream,
  },
  groupOn: { backgroundColor: colors.amberSoft },
  groupText: { fontFamily: fonts.bold, fontSize: 13, color: colors.cocoaSoft },
  groupTextOn: { color: colors.amberDark },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  chipText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoaSoft },
  chipTextOn: { color: colors.white },
}));
