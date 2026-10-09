import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { User } from '../types';
import { Avatar } from './Avatar';

/** Plenty for a dinner table, and keeps a post from becoming a mass ping. */
export const MAX_TAGS = 20;

/**
 * The "Tag people" sheet. People you follow are listed first; search finds
 * anyone else. Who you've picked sits at the top as chips you can tap off.
 *
 * Two ways to use it:
 *  - `postId`: an existing post of yours (its ··· menu). Saved on Done.
 *  - `selected` + `onChangeSelected`: while writing a new post, which doesn't
 *    exist yet. Compose tags them when it posts.
 *
 * Draws its own tap-outside-to-close area (no dim: the screen behind stays as
 * it was), so it can sit inside a Modal or be a whole transparent screen.
 */
export function TagPeoplePicker({
  postId,
  selected,
  onChangeSelected,
  onClose,
}: {
  postId?: string;
  selected?: User[];
  onChangeSelected?: (users: User[]) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const svc = getDataService();
  const { user, refreshFeed } = useApp();
  const insets = useSafeAreaInsets();
  const live = Boolean(postId);

  const [picked, setPicked] = useState<User[]>(selected ?? []);
  const [following, setFollowing] = useState<User[]>([]);
  const [results, setResults] = useState<User[] | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    Promise.all([
      svc.getFollowingUsers(user.id),
      postId ? svc.getPost(postId) : Promise.resolve(null),
    ])
      .then(([f, p]) => {
        if (!alive) return;
        setFollowing(f);
        if (p) setPicked(p.tagged ?? []);
      })
      .catch((e) => alive && setError(e?.message ?? 'Could not load people'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // `selected` is only the starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, user, postId]);

  // Search everyone as you type; an empty box shows who you follow.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      svc
        .listUsers(term)
        .then((list) => alive && setResults(list))
        .catch(() => alive && setResults([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [svc, query]);

  const pickedIds = useMemo(() => new Set(picked.map((u) => u.id)), [picked]);
  const rows = (results ?? following).filter((u) => u.id !== user?.id);

  const update = (next: User[]) => {
    setPicked(next);
    setError(null);
    if (!live) onChangeSelected?.(next);
  };

  const toggle = useCallback(
    (u: User) => {
      if (pickedIds.has(u.id)) {
        update(picked.filter((x) => x.id !== u.id));
      } else if (picked.length >= MAX_TAGS) {
        setError(`You can tag up to ${MAX_TAGS} people`);
      } else {
        update([...picked, u]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, pickedIds],
  );

  const done = async () => {
    if (!live) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await svc.setPostTags(postId!, picked.map((u) => u.id));
      refreshFeed();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save those tags');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <Pressable testID="tag-picker-backdrop" style={styles.backdrop} onPress={onClose} />
      <View
        testID="tag-picker"
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
      >
        <View style={styles.grabber} />
        <View style={styles.head}>
          <Text style={styles.title}>Tag people</Text>
          <Pressable testID="tag-picker-done" onPress={done} disabled={saving} hitSlop={10}>
            <Text style={[styles.done, saving && { opacity: 0.5 }]}>
              {saving ? 'Saving' : 'Done'}
            </Text>
          </Pressable>
        </View>

        {picked.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            {picked.map((u) => (
              <Pressable
                key={u.id}
                testID={`tag-chip-${u.id}`}
                onPress={() => toggle(u)}
                style={styles.chip}
              >
                <Avatar user={u} size={22} />
                <Text style={styles.chipText} numberOfLines={1}>
                  {u.display_name}
                </Text>
                <Ionicons name="close" size={14} color={colors.cocoaSoft} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={colors.cocoaFaint} />
          <TextInput
            keyboardAppearance={colors.dark ? 'dark' : 'light'}
            testID="tag-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Search people"
            placeholderTextColor={colors.cocoaFaint}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {error ? (
          <Text testID="tag-error" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.amber} style={{ marginVertical: spacing.lg }} />
        ) : (
          <ScrollView
            style={{ maxHeight: 320 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {!results ? <Text style={styles.section}>People you follow</Text> : null}
            {rows.map((u) => {
              const on = pickedIds.has(u.id);
              return (
                <Pressable
                  key={u.id}
                  testID={`tag-option-${u.id}`}
                  onPress={() => toggle(u)}
                  style={styles.row}
                >
                  <Avatar user={u} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {u.display_name}
                    </Text>
                    <Text style={styles.handle} numberOfLines={1}>
                      @{u.handle}
                    </Text>
                  </View>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={on ? colors.amberDark : colors.cocoaFaint}
                  />
                </Pressable>
              );
            })}
            {rows.length === 0 ? (
              <Text style={styles.empty}>
                {results ? 'No one by that name' : 'Search for someone to tag'}
              </Text>
            ) : null}
          </ScrollView>
        )}
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
  done: { fontFamily: fonts.bold, fontSize: 15, color: colors.amberDark },
  chips: { gap: spacing.xs, paddingBottom: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 10,
    maxWidth: 180,
  },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.cocoa, flexShrink: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    marginBottom: spacing.sm,
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
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  handle: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint },
  error: { fontFamily: fonts.semi, fontSize: 13, color: colors.danger, marginBottom: spacing.xs },
  empty: {
    fontFamily: fonts.semi,
    fontSize: 13.5,
    color: colors.cocoaFaint,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
}));
