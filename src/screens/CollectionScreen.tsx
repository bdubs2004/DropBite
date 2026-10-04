import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionSheet } from '../components/ActionSheet';
import { PostThumb } from '../components/PostThumb';
import { RenameGroupSheet } from '../components/RenameGroupSheet';
import { Button, Muted } from '../components/ui';
import { COLLECTION_NAME_MAX, collectionNameProblem } from '../lib/collectionName';
import { openPostFeed } from '../lib/postFeed';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';
import { Collection, Post } from '../types';

const GRID_COLUMNS = 3;
const GRID_GAP = 2;

/** Pad to whole rows so a lone final tile stays a third wide. */
const padRows = (items: Post[]): (Post | null)[] => {
  const remainder = items.length % GRID_COLUMNS;
  return remainder ? [...items, ...Array(GRID_COLUMNS - remainder).fill(null)] : items;
};

/**
 * One collection: its posts as a grid, opening into a mini feed like any other
 * grid. The owner also gets "Add or remove posts" (tick posts from all of
 * their own), rename and delete in the ··· menu.
 */
export function CollectionScreen({ navigation, route }: any) {
  const collectionId: string = route.params.collectionId;
  const svc = getDataService();
  const { user, hiddenIds } = useApp();
  const insets = useSafeAreaInsets();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);

  // Picking mode: every one of your posts, tick the ones that belong here.
  const [picking, setPicking] = useState<boolean>(Boolean(route.params?.pickPosts));
  const [myPosts, setMyPosts] = useState<Post[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [savingPicks, setSavingPicks] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isMine = Boolean(collection && user && collection.user_id === user.id);
  const name = collection?.name ?? route.params?.name ?? 'Collection';

  const load = useCallback(async () => {
    const [c, items] = await Promise.all([
      svc.getCollection(collectionId),
      svc.getCollectionPosts(collectionId),
    ]);
    if (!c) {
      setGone(true);
      setLoading(false);
      return;
    }
    setCollection(c);
    setPosts(items);
    if (picking && user && c.user_id === user.id) {
      setMyPosts(await svc.getUserPosts(user.id));
      setChosen(new Set(items.map((p) => p.id)));
    }
    setLoading(false);
    // Only re-run on focus / id changes, not every time picking flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, collectionId, user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const startPicking = async () => {
    if (!user) return;
    setMyPosts(await svc.getUserPosts(user.id));
    setChosen(new Set(posts.map((p) => p.id)));
    setPicking(true);
  };

  const flip = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const savePicks = async () => {
    setSavingPicks(true);
    try {
      const before = new Set(posts.map((p) => p.id));
      const changes = [
        ...[...chosen].filter((id) => !before.has(id)).map((id) => [id, true] as const),
        ...[...before].filter((id) => !chosen.has(id)).map((id) => [id, false] as const),
      ];
      for (const [id, inside] of changes) {
        await svc.setPostInCollection(collectionId, id, inside);
      }
      setPicking(false);
      await load();
    } finally {
      setSavingPicks(false);
    }
  };

  const rename = async (text: string) => {
    const others: string[] = user
      ? (await svc.getCollections(user.id))
          .filter((c) => c.id !== collectionId)
          .map((c) => c.name)
      : [];
    const problem = collectionNameProblem(text, others);
    if (problem) {
      setRenameError(problem);
      return;
    }
    try {
      await svc.renameCollection(collectionId, text);
      setRenaming(false);
      setRenameError(null);
      load();
    } catch (e: any) {
      setRenameError(e?.message ?? 'Could not rename that collection');
    }
  };

  const runDelete = async () => {
    await svc.deleteCollection(collectionId);
    navigation.goBack();
  };

  const askDelete = () => {
    setConfirmingDelete(true);
  };

  const visible = posts.filter((p) => !hiddenIds.has(p.id));
  const count = visible.length;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {picking ? (
          <Pressable
            testID="collection-pick-cancel"
            onPress={() => setPicking(false)}
            hitSlop={10}
            style={styles.side}
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={[styles.side, styles.backBtn]}>
            <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
            <Text style={styles.back}>Back</Text>
          </Pressable>
        )}
        <Text testID="collection-title" style={styles.title} numberOfLines={1}>
          {picking ? 'Pick posts' : name}
        </Text>
        <View style={[styles.side, { alignItems: 'flex-end' }]}>
          {picking ? (
            <Pressable testID="collection-pick-done" onPress={savePicks} disabled={savingPicks} hitSlop={10}>
              <Text style={[styles.done, savingPicks && { opacity: 0.5 }]}>
                {savingPicks ? 'Saving' : 'Done'}
              </Text>
            </Pressable>
          ) : isMine ? (
            <Pressable testID="collection-menu" onPress={() => setMenuOpen(true)} hitSlop={10}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.cocoaSoft} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {confirmingDelete ? (
        <View style={styles.confirmBar}>
          <Text style={styles.confirmText}>
            Delete {name}? The posts in it stay on your profile
          </Text>
          <View style={styles.confirmActions}>
            <Button title="Cancel" variant="secondary" small onPress={() => setConfirmingDelete(false)} />
            <Button testID="collection-delete-confirm" title="Delete" variant="danger" small onPress={runDelete} />
          </View>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : gone ? (
        <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
          This collection is no longer available
        </Muted>
      ) : picking ? (
        <FlatList
          key="pick"
          testID="collection-pick-grid"
          data={padRows(myPosts)}
          keyExtractor={(p, i) => p?.id ?? `spacer-${i}`}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 120 }}
          ListHeaderComponent={
            <Muted style={styles.pickHint}>
              {chosen.size === 1 ? '1 post selected' : `${chosen.size} posts selected`}
            </Muted>
          }
          renderItem={({ item }) =>
            item ? (
              <View style={{ flex: 1 }}>
                <PostThumb post={item} onPress={() => flip(item.id)} />
                <View pointerEvents="none" style={styles.tick}>
                  <Ionicons
                    name={chosen.has(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
                    size={26}
                    color={chosen.has(item.id) ? colors.amber : colors.white}
                  />
                </View>
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )
          }
          ListEmptyComponent={
            <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
              Post something first, then add it here
            </Muted>
          }
        />
      ) : (
        <FlatList
          key="grid"
          testID="collection-grid"
          data={padRows(visible)}
          keyExtractor={(p, i) => p?.id ?? `spacer-${i}`}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 120 }}
          ListHeaderComponent={
            count > 0 ? (
              <Text style={styles.sub}>{count === 1 ? '1 post' : `${count} posts`}</Text>
            ) : null
          }
          renderItem={({ item }) =>
            item ? (
              <PostThumb
                post={item}
                onPress={() => openPostFeed(navigation, visible, item.id, name)}
                onLongPress={() => navigation.navigate('PostPeek', { postId: item.id })}
                style={{ flex: 1 }}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="albums-outline" size={40} color={colors.cocoaFaint} />
              <Muted style={{ textAlign: 'center' }}>
                {isMine ? 'Nothing in here yet' : 'No posts in this collection yet'}
              </Muted>
              {isMine ? (
                <Button testID="collection-add-posts" title="Add posts" onPress={startPicking} small />
              ) : null}
            </View>
          }
        />
      )}

      <ActionSheet
        visible={menuOpen}
        title={name}
        onClose={() => setMenuOpen(false)}
        actions={[
          {
            key: 'pick',
            label: 'Add or remove posts',
            hint: 'Choose which of your posts belong here',
            icon: 'checkmark-circle-outline',
            onPress: startPicking,
          },
          {
            key: 'rename',
            label: 'Rename',
            icon: 'create-outline',
            onPress: () => {
              setRenameError(null);
              setRenaming(true);
            },
          },
          {
            key: 'delete',
            label: 'Delete collection',
            hint: 'The posts stay on your profile',
            icon: 'trash-outline',
            destructive: true,
            onPress: askDelete,
          },
        ]}
      />

      <RenameGroupSheet
        visible={renaming}
        initial={name}
        title="Rename collection"
        placeholder="Collection name"
        maxLength={COLLECTION_NAME_MAX + 10}
        error={renameError}
        testIDPrefix="collection-rename"
        onCancel={() => setRenaming(false)}
        onSave={rename}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  side: { width: 70 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -4 },
  back: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  cancel: { fontFamily: fonts.bold, color: colors.cocoaSoft, fontSize: 15 },
  done: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cocoa,
  },
  sub: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.cocoaFaint,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  pickHint: { textAlign: 'center', marginBottom: spacing.sm },
  tick: { position: 'absolute', top: 6, right: 6 },
  empty: { alignItems: 'center', gap: spacing.md, marginTop: 60, paddingHorizontal: spacing.xl },
  confirmBar: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    gap: spacing.sm,
  },
  confirmText: { fontFamily: fonts.semi, fontSize: 14, color: colors.cocoa },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
