import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
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
import { COLLECTION_NAME_MAX, collectionNameProblem } from '../lib/collectionName';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { Collection } from '../types';
import { PostPhoto } from './PostPhoto';

/**
 * The "Add to collection" sheet: your collections with a check on the ones
 * this post is in, plus a quick "New collection" at the top.
 *
 * Two ways to use it:
 *  - `postId`: for a post that already exists (the ··· menu). Every tap saves
 *    straight away, so there's nothing to confirm.
 *  - `selected` + `onChangeSelected`: while writing a new post, which doesn't
 *    exist yet. Just tracks the choice; Compose files it after posting.
 *
 * Draws its own tap-outside-to-close area (no dim: the screen behind stays as
 * it was), so it can sit inside a Modal or be a whole transparent screen.
 */
export function CollectionPicker({
  postId,
  selected,
  onChangeSelected,
  onClose,
}: {
  postId?: string;
  selected?: string[];
  /** Called with the chosen ids and their names (for showing the choice). */
  onChangeSelected?: (ids: string[], names: string[]) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const svc = getDataService();
  const { user } = useApp();
  const insets = useSafeAreaInsets();
  const live = Boolean(postId);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [inside, setInside] = useState<Set<string>>(new Set(selected ?? []));
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [cols, ids] = await Promise.all([
        svc.getCollections(user.id),
        postId ? svc.getPostCollectionIds(postId) : Promise.resolve(selected ?? []),
      ]);
      setCollections(cols);
      setInside(new Set(ids));
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your collections');
    } finally {
      setLoading(false);
    }
    // `selected` is only the starting point; later changes come from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, user, postId]);

  useEffect(() => {
    load();
  }, [load]);

  const publish = (next: Set<string>, list: Collection[] = collections) => {
    setInside(next);
    onChangeSelected?.(
      [...next],
      list.filter((c) => next.has(c.id)).map((c) => c.name),
    );
  };

  const toggle = async (c: Collection) => {
    const on = !inside.has(c.id);
    const next = new Set(inside);
    if (on) next.add(c.id);
    else next.delete(c.id);
    publish(next);
    if (!live) return;
    // Saved straight away; the count on the row moves with it.
    setCollections((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, post_count: x.post_count + (on ? 1 : -1) } : x)),
    );
    try {
      await svc.setPostInCollection(c.id, postId!, on);
    } catch (e: any) {
      setError(e?.message ?? 'Could not update that collection');
      load();
    }
  };

  const create = async () => {
    const problem = collectionNameProblem(
      name,
      collections.map((c) => c.name),
    );
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const made = await svc.createCollection(name);
      // A new collection starts with this post in it: that's why you made it.
      if (live) await svc.setPostInCollection(made.id, postId!, true);
      const list = [{ ...made, post_count: live ? 1 : 0 }, ...collections];
      setCollections(list);
      publish(new Set([...inside, made.id]), list);
      setName('');
      setCreating(false);
    } catch (e: any) {
      setError(e?.message ?? 'Could not make that collection');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <Pressable testID="collection-picker-backdrop" style={styles.backdrop} onPress={onClose} />
      <View
        testID="collection-picker"
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
      >
        <View style={styles.grabber} />
        <View style={styles.head}>
          <Text style={styles.title}>Add to collection</Text>
          <Pressable testID="collection-picker-done" onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        {creating ? (
          <View style={styles.newRow}>
            <TextInput
              keyboardAppearance={colors.dark ? 'dark' : 'light'}
              testID="collection-name-input"
              value={name}
              onChangeText={(t) => {
                setName(t);
                setError(null);
              }}
              placeholder="Crockpot meals, desserts..."
              placeholderTextColor={colors.cocoaFaint}
              style={styles.input}
              maxLength={COLLECTION_NAME_MAX + 10}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={create}
            />
            <Pressable
              testID="collection-create"
              onPress={create}
              disabled={saving}
              style={[styles.createBtn, saving && { opacity: 0.6 }]}
            >
              <Text style={styles.createText}>{saving ? 'Adding' : 'Create'}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            testID="collection-new"
            onPress={() => setCreating(true)}
            style={styles.row}
          >
            <View style={[styles.cover, styles.newCover]}>
              <Ionicons name="add" size={24} color={colors.amberDark} />
            </View>
            <Text style={[styles.name, { color: colors.amberDark }]}>New collection</Text>
          </Pressable>
        )}

        {error ? (
          <Text testID="collection-error" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.amber} style={{ marginVertical: spacing.lg }} />
        ) : (
          <ScrollView
            style={{ maxHeight: 340 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {collections.map((c) => {
              const on = inside.has(c.id);
              return (
                <Pressable
                  key={c.id}
                  testID={`collection-option-${c.id}`}
                  onPress={() => toggle(c)}
                  style={styles.row}
                >
                  <View style={styles.cover}>
                    {c.cover ? (
                      <PostPhoto post={c.cover} ratio={1} />
                    ) : (
                      <Ionicons name="albums-outline" size={20} color={colors.cocoaFaint} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.count}>
                      {c.post_count === 1 ? '1 post' : `${c.post_count} posts`}
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
            {collections.length === 0 && !creating ? (
              <Text style={styles.empty}>
                Group your posts into collections like crockpot meals or desserts
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.creamDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newCover: { backgroundColor: colors.amberSoft },
  name: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  count: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 1 },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fonts.semi,
    fontSize: 15.5,
    color: colors.cocoa,
  },
  createBtn: {
    backgroundColor: colors.amber,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  createText: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.onAmber },
  error: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.danger,
    marginBottom: spacing.xs,
  },
  empty: {
    fontFamily: fonts.semi,
    fontSize: 13.5,
    color: colors.cocoaFaint,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
}));
