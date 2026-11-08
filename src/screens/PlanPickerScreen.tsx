import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostPhoto } from '../components/PostPhoto';
import { PostThumb } from '../components/PostThumb';
import { BuiltCard, RecipeBuilder, saveBuiltCard } from '../components/RecipeBuilder';
import { Button, Muted } from '../components/ui';
import { dayKey, dayName } from '../lib/mealPlan';
import { recipeSummary } from '../lib/myRecipe';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, photoGrid, radius, spacing, makeStyles, useColors } from '../theme';
import { Collection, MealSlot, MyRecipe, Post } from '../types';

type Tab = 'saved' | 'collections' | 'recipes' | 'new';
const TABS: { key: Tab; label: string }[] = [
  { key: 'saved', label: 'Saved' },
  { key: 'collections', label: 'Collections' },
  { key: 'recipes', label: 'Recipes' },
  { key: 'new', label: 'New' },
];

const TILE = Math.floor(
  (Dimensions.get('window').width - photoGrid.side * 2 - photoGrid.gap * (photoGrid.columns - 1)) /
    photoGrid.columns,
);

/**
 * Fill one meal on the plan: a saved post, a post from one of your
 * collections, one of your own recipes, or something new. Something new is a
 * name ("Taco night") and, if you like, a recipe card, written by hand or
 * formatted by the AI from however you describe it. The card is saved to your
 * Recipes, so next time it's one tap.
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
  const [recipes, setRecipes] = useState<MyRecipe[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New
  const [name, setName] = useState('');
  const [built, setBuilt] = useState<BuiltCard | null>(null);

  useEffect(() => {
    if (tab === 'saved' && !saved) svc.getSavedPosts().then(setSaved, () => setSaved([]));
    if (tab === 'collections' && !collections && user) {
      svc.getCollections(user.id).then(setCollections, () => setCollections([]));
    }
    if (tab === 'recipes' && !recipes) svc.getMyRecipes().then(setRecipes, () => setRecipes([]));
  }, [svc, tab, saved, collections, recipes, user]);

  useEffect(() => {
    setColPosts(null);
    if (openCol) svc.getCollectionPosts(openCol.id).then(setColPosts, () => setColPosts([]));
  }, [svc, openCol]);

  const add = async (input: { postId?: string; title?: string; recipeId?: string }) => {
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

  /** New: save the card to your recipes (if there is one), then plan it. */
  const addNew = async () => {
    if (busy) return;
    if (!built) {
      if (name.trim()) add({ title: name });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveBuiltCard(svc, built, name);
      // Shows up under Recipes next time, even if adding to the plan fails.
      setRecipes(null);
      await svc.addPlanItem({ date, slot, title: name.trim() || saved.title, recipeId: saved.id });
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
            onPress={() => {
              setTab(t.key);
              setError(null);
            }}
            style={[styles.tab, tab === t.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && tab !== 'new' ? (
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
                style={styles.row}
              >
                <View style={styles.cover}>
                  {item.cover ? (
                    <PostPhoto post={item.cover} ratio={1} />
                  ) : (
                    <Ionicons name="albums-outline" size={18} color={colors.cocoaFaint} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowSub}>
                    {item.post_count === 1 ? '1 post' : `${item.post_count} posts`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.cocoaFaint} />
              </Pressable>
            )}
            ListEmptyComponent={<Muted style={styles.empty}>No collections yet</Muted>}
          />
        )
      ) : tab === 'recipes' ? (
        recipes === null ? (
          <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            data={recipes}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
            renderItem={({ item }) => (
              <Pressable
                testID={`picker-recipe-${item.id}`}
                onPress={() => add({ recipeId: item.id, title: item.title })}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              >
                <View style={[styles.cover, { backgroundColor: colors.meal[slot].bg }]}>
                  <Ionicons name="book" size={20} color={colors.meal[slot].color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {recipeSummary(item) ? <Text style={styles.rowSub}>{recipeSummary(item)}</Text> : null}
                </View>
                <Ionicons name="add" size={22} color={colors.cocoaSoft} />
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Muted style={{ textAlign: 'center' }}>Recipes you make for your plan show up here</Muted>
                <Button testID="picker-recipes-new" title="Make one" small variant="secondary" onPress={() => setTab('new')} />
              </View>
            }
          />
        )
      ) : (
        <ScrollView
          contentContainerStyle={[styles.newBody, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <TextInput
            testID="picker-title"
            keyboardAppearance={colors.dark ? 'dark' : 'light'}
            value={name}
            onChangeText={(t) => {
              setName(t);
              setError(null);
            }}
            placeholder="Tacos, leftovers, pizza night..."
            placeholderTextColor={colors.cocoaFaint}
            style={styles.input}
            maxLength={80}
            autoFocus={!built}
            returnKeyType="done"
          />

          <Text style={styles.section}>Recipe card or ingredients (optional)</Text>
          <RecipeBuilder name={name} value={built} onChange={setBuilt} onError={setError} />

          {error ? (
            <Text testID="picker-error" style={[styles.error, { marginHorizontal: 0 }]}>
              {error}
            </Text>
          ) : null}

          <Button
            testID="picker-add"
            title={built ? (built.ingredientsOnly ? 'Save and add' : 'Save recipe and add') : 'Add'}
            onPress={addNew}
            disabled={!name.trim() && !built}
            loading={busy}
            style={{ marginTop: spacing.sm }}
          />
        </ScrollView>
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
  tabText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoaFaint },
  tabTextActive: { color: colors.cocoa },
  error: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.danger,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  empty: { textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.xl },
  emptyBox: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, paddingHorizontal: spacing.xl },
  colBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  colBackText: { fontFamily: fonts.bold, fontSize: 15, color: colors.amberDark },
  row: {
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
  rowName: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  rowSub: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 1 },
  newBody: { paddingHorizontal: spacing.lg, gap: spacing.md },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fonts.semi,
    fontSize: 15.5,
    color: colors.cocoa,
  },
  section: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoaSoft, marginTop: spacing.xs, marginBottom: -spacing.xs },
}));
