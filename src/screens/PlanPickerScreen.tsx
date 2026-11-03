import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostPhoto } from '../components/PostPhoto';
import { PostThumb } from '../components/PostThumb';
import { Button, Muted } from '../components/ui';
import { dayKey, dayName } from '../lib/mealPlan';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, photoGrid, radius, spacing, makeStyles, useColors } from '../theme';
import { Collection, MealSlot, Post } from '../types';

type Tab = 'saved' | 'collections' | 'typed';
const TABS: { key: Tab; label: string }[] = [
  { key: 'saved', label: 'Saved' },
  { key: 'collections', label: 'Collections' },
  { key: 'typed', label: 'Type it' },
];

const TILE = Math.floor(
  (Dimensions.get('window').width - photoGrid.side * 2 - photoGrid.gap * (photoGrid.columns - 1)) /
    photoGrid.columns,
);

/**
 * Fill one meal on the plan: pick a saved post, a post from one of your
 * collections, or just type what it is ("Leftovers", "Pizza night").
 */
export function PlanPickerScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const { user } = useApp();
  const { date, slot } = route.params as { date: string; slot: MealSlot };

  const [tab, setTab] = useState<Tab>('saved');
  const [saved, setSaved] = useState<Post[] | null>(null);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [openCol, setOpenCol] = useState<Collection | null>(null);
  const [colPosts, setColPosts] = useState<Post[] | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === 'saved' && !saved) svc.getSavedPosts().then(setSaved, () => setSaved([]));
    if (tab === 'collections' && !collections && user) {
      svc.getCollections(user.id).then(setCollections, () => setCollections([]));
    }
  }, [svc, tab, saved, collections, user]);

  useEffect(() => {
    setColPosts(null);
    if (openCol) svc.getCollectionPosts(openCol.id).then(setColPosts, () => setColPosts([]));
  }, [svc, openCol]);

  const add = async (input: { postId?: string; title?: string }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await svc.addPlanItem({ date, slot, ...input });
      navigation.goBack();
    } catch (e: any) {
      setError(e?.message ?? 'Could not add that meal');
      setBusy(false);
    }
  };

  const grid = (posts: Post[] | null, empty: string) =>
    posts === null ? (
      <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
    ) : (
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        numColumns={photoGrid.columns}
        columnWrapperStyle={{ gap: photoGrid.gap, paddingHorizontal: photoGrid.side }}
        contentContainerStyle={{ gap: photoGrid.gap, paddingBottom: insets.bottom + 40 }}
        renderItem={({ item }) => (
          <PostThumb
            post={item}
            onPress={() => add({ postId: item.id })}
            style={{ width: TILE, height: TILE }}
            radius={photoGrid.radius}
          />
        )}
        ListEmptyComponent={<Muted style={styles.empty}>{empty}</Muted>}
      />
    );

  const label = `${dayName(date, dayKey(new Date()))} ${colors.meal[slot].label.toLowerCase()}`;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <Pressable testID="picker-cancel" onPress={() => navigation.goBack()} hitSlop={10} style={{ width: 60 }}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {label}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            testID={`picker-tab-${t.key}`}
            onPress={() => setTab(t.key)}
            style={[styles.tab, tab === t.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text testID="picker-error" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {tab === 'saved' ? (
        grid(saved, 'Posts you save show up here')
      ) : tab === 'collections' ? (
        openCol ? (
          <>
            <Pressable onPress={() => setOpenCol(null)} style={styles.colBack} hitSlop={6}>
              <Ionicons name="chevron-back" size={18} color={colors.amberDark} />
              <Text style={styles.colBackText} numberOfLines={1}>
                {openCol.name}
              </Text>
            </Pressable>
            {grid(colPosts, 'Nothing in this collection yet')}
          </>
        ) : collections === null ? (
          <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            data={collections}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
            renderItem={({ item }) => (
              <Pressable
                testID={`picker-collection-${item.id}`}
                onPress={() => setOpenCol(item)}
                style={styles.colRow}
              >
                <View style={styles.cover}>
                  {item.cover ? (
                    <PostPhoto post={item.cover} ratio={1} />
                  ) : (
                    <Ionicons name="albums-outline" size={18} color={colors.cocoaFaint} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.colName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.colCount}>
                    {item.post_count === 1 ? '1 post' : `${item.post_count} posts`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.cocoaFaint} />
              </Pressable>
            )}
            ListEmptyComponent={<Muted style={styles.empty}>No collections yet</Muted>}
          />
        )
      ) : (
        <View style={styles.typed}>
          <TextInput
            testID="picker-title"
            keyboardAppearance={colors.dark ? 'dark' : 'light'}
            value={typed}
            onChangeText={(t) => {
              setTyped(t);
              setError(null);
            }}
            placeholder="Tacos, leftovers, pizza night..."
            placeholderTextColor={colors.cocoaFaint}
            style={styles.input}
            maxLength={80}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => typed.trim() && add({ title: typed })}
          />
          <Button
            testID="picker-add"
            title="Add"
            onPress={() => add({ title: typed })}
            disabled={!typed.trim()}
            loading={busy}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  cancel: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: colors.hairline,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderColor: 'transparent',
    marginBottom: -1,
  },
  tabActive: { borderColor: colors.cocoa },
  tabText: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoaFaint },
  tabTextActive: { color: colors.cocoa },
  error: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.danger,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  empty: { textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.xl },
  colBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  colBackText: { fontFamily: fonts.bold, fontSize: 15, color: colors.amberDark },
  colRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.creamDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colName: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  colCount: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 1 },
  typed: { paddingHorizontal: spacing.lg, gap: spacing.md },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fonts.semi,
    fontSize: 15.5,
    color: colors.cocoa,
  },
}));
