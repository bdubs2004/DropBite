import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { AISLES, Aisle, GroceryLine, aisleOf, buildGroceryList, groceryText, itemKey } from '../lib/grocery';
import { addDays, dayKey, weekLabel, weekStart } from '../lib/mealPlan';
import { systemShare } from '../lib/share';
import { getDataService } from '../services';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { GroceryMark, MealPlanItem } from '../types';
import { planItemTitle } from './MealPlanScreen';

type Mode = 'home' | 'store';

type Line = GroceryLine & { have: boolean; got: boolean };

/**
 * The week's grocery list, worked out from the meal plan: every ingredient on
 * every recipe that week, added up and grouped by aisle. Two passes, like a
 * paper list: At home, tick what you already have; At the store, tick what
 * goes in the cart (what you have is left off). Add anything else by hand.
 * On a family plan the list is shared, so whoever shops sees what the rest
 * already ticked.
 */
export function GroceryScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const today = dayKey(new Date());
  const [monday, setMonday] = useState<string>(weekStart(route.params?.week ?? today));
  const [mode, setMode] = useState<Mode>('home');
  const [items, setItems] = useState<MealPlanItem[]>([]);
  const [marks, setMarks] = useState<GroceryMark[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const [plan, m] = await Promise.all([svc.getMealPlan(monday, addDays(monday, 6)), svc.getGroceryMarks(monday)]);
      if (ticket !== latest.current) return;
      setItems(plan);
      setMarks(m);
      setError(null);
    } catch (e: any) {
      if (ticket === latest.current) setError(e?.message ?? 'Could not load the list');
    } finally {
      if (ticket === latest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [svc, monday]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Meals waiting for the admin aren't on the plan yet, so they aren't shopped for.
  const planned = items.filter((i) => i.status === 'in');
  const noRecipe = planned.filter(
    (i) => !(i.post?.recipe?.ingredients.length || i.recipe?.ingredients.length),
  );

  const lines: Line[] = useMemo(() => {
    const fromPlan = buildGroceryList(
      planned.map((i) => ({
        meal: planItemTitle(i),
        ingredients: i.post?.recipe?.ingredients ?? i.recipe?.ingredients ?? [],
      })),
    );
    const byKey = new Map(marks.map((m) => [m.item_key, m]));
    const keys = new Set(fromPlan.map((l) => l.key));
    const custom: GroceryLine[] = marks
      .filter((m) => m.custom && !keys.has(m.item_key))
      .map((m) => ({
        key: m.item_key,
        name: m.label ?? m.item_key,
        amount: '',
        meals: [],
        aisle: aisleOf(itemKey(m.label ?? m.item_key)),
        custom: true,
      }));
    return [...fromPlan, ...custom].map((l) => ({
      ...l,
      have: byKey.get(l.key)?.have ?? false,
      got: byKey.get(l.key)?.got ?? false,
    }));
    // planned is derived from items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, marks]);

  const mark = (key: string, patch: Partial<Pick<GroceryMark, 'have' | 'got'>>) => {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    const have = patch.have ?? line.have;
    const got = patch.got ?? line.got;
    const before = marks;
    // Straight away; put back if the save fails.
    setMarks((prev) =>
      prev.some((m) => m.item_key === key)
        ? prev.map((m) => (m.item_key === key ? { ...m, have, got } : m))
        : [...prev, { item_key: key, custom: false, label: null, have, got }],
    );
    svc.setGroceryItem(monday, key, have, got).catch((e: any) => {
      setMarks(before);
      setError(e?.message ?? 'Could not save that');
    });
  };

  const addItem = async () => {
    const label = adding.trim();
    if (!label) return;
    setAdding('');
    try {
      await svc.addGroceryItem(monday, label);
      load();
    } catch (e: any) {
      setAdding(label);
      setError(e?.message ?? 'Could not add that');
    }
  };

  const removeItem = async (key: string) => {
    setMarks((prev) => prev.filter((m) => m.item_key !== key));
    try {
      await svc.removeGroceryItem(monday, key);
    } catch (e: any) {
      setError(e?.message ?? 'Could not remove that');
      load();
    }
  };

  const share = () =>
    systemShare({
      title: 'Grocery list',
      message: groceryText(
        lines.filter((l) => !l.have).map((l) => ({ name: l.name, amount: l.amount, done: l.got })),
        `Groceries for ${weekLabel(monday, today).toLowerCase()}`,
      ),
    });

  const shown = mode === 'home' ? lines : lines.filter((l) => !l.have);
  const toGet = mode === 'store' ? shown.filter((l) => !l.got) : shown;
  const inCart = mode === 'store' ? shown.filter((l) => l.got) : [];
  const haveCount = lines.filter((l) => l.have).length;
  const cartCount = inCart.length;
  const storeTotal = shown.length;

  const byAisle = (list: Line[]) =>
    AISLES.map((a) => [a, list.filter((l) => l.aisle === a)] as [Aisle, Line[]]).filter(([, ls]) => ls.length);

  const row = (l: Line) => {
    const on = mode === 'home' ? l.have : l.got;
    return (
      <View key={l.key} style={styles.row}>
        <Pressable
          testID={`grocery-item-${l.key}`}
          onPress={() => (mode === 'home' ? mark(l.key, { have: !l.have }) : mark(l.key, { got: !l.got }))}
          style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.6 }]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          accessibilityLabel={`${l.name}${l.amount ? `, ${l.amount}` : ''}`}
        >
          <View style={[styles.box, on && styles.boxOn]}>
            {on ? <Ionicons name="checkmark" size={16} color={colors.onAmber} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, on && styles.nameDone]} numberOfLines={2}>
              {l.name}
              {l.amount ? <Text style={styles.amount}>  {l.amount}</Text> : null}
            </Text>
            {l.meals.length ? (
              <Text style={styles.meals} numberOfLines={1}>
                {l.meals.join(', ')}
              </Text>
            ) : null}
          </View>
          {mode === 'home' && l.have ? <Text style={styles.haveTag}>Have it</Text> : null}
        </Pressable>
        {l.custom ? (
          <Pressable
            testID={`grocery-remove-${l.key}`}
            onPress={() => removeItem(l.key)}
            hitSlop={8}
            accessibilityLabel={`Remove ${l.name}`}
          >
            <Ionicons name="close" size={18} color={colors.cocoaFaint} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.side}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Groceries</Text>
        <View style={[styles.side, { justifyContent: 'flex-end' }]}>
          {lines.some((l) => !l.have) ? (
            <Pressable testID="grocery-share" onPress={share} hitSlop={10} accessibilityLabel="Send the list">
              <Ionicons name="share-outline" size={22} color={colors.cocoa} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.tabs}>
        {(['home', 'store'] as Mode[]).map((m) => (
          <Pressable
            key={m}
            testID={`grocery-mode-${m}`}
            onPress={() => setMode(m)}
            style={[styles.tab, mode === m && styles.tabActive]}
          >
            <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
              {m === 'home' ? 'At home' : 'At the store'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.weekBar}>
        <Pressable testID="grocery-prev" onPress={() => { setLoading(true); setMonday((d) => addDays(d, -7)); }} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={colors.cocoaSoft} />
        </Pressable>
        <Text testID="grocery-week" style={styles.weekLabel}>
          {weekLabel(monday, today)}
        </Text>
        <Pressable testID="grocery-next" onPress={() => { setLoading(true); setMonday((d) => addDays(d, 7)); }} hitSlop={10}>
          <Ionicons name="chevron-forward" size={20} color={colors.cocoaSoft} />
        </Pressable>
      </View>

      {error ? (
        <Text testID="grocery-error" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {loading && !lines.length ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.amber}
            />
          }
        >
          {lines.length ? (
            <View style={styles.summary}>
              <Text testID="grocery-summary" style={styles.summaryText}>
                {mode === 'home'
                  ? `${lines.length} ${lines.length === 1 ? 'item' : 'items'}${haveCount ? `, ${haveCount} at home already` : ''}. Tick what you have`
                  : storeTotal
                    ? `${cartCount} of ${storeTotal} in the cart`
                    : 'You have everything'}
              </Text>
              {mode === 'store' && storeTotal ? (
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.round((cartCount / storeTotal) * 100)}%` }]} />
                </View>
              ) : null}
            </View>
          ) : null}

          {noRecipe.length ? (
            <Text testID="grocery-no-recipe" style={styles.noRecipe}>
              No recipe for {noRecipe.map(planItemTitle).join(', ')}. Add what they need below
            </Text>
          ) : null}

          {byAisle(toGet).map(([aisle, ls]) => (
            <View key={aisle} style={styles.section}>
              <Text style={styles.aisle}>{aisle}</Text>
              {ls.map(row)}
            </View>
          ))}

          {inCart.length ? (
            <View style={styles.section}>
              <Text style={styles.aisle}>In the cart</Text>
              {inCart.map(row)}
            </View>
          ) : null}

          {!lines.length ? (
            <View style={styles.empty}>
              <Ionicons name="cart-outline" size={40} color={colors.cocoaFaint} />
              <Text style={styles.emptyText}>
                Plan meals with recipes this week and everything they need shows up here
              </Text>
              <Button title="Open meal plan" small variant="secondary" onPress={() => navigation.navigate('MealPlan')} />
            </View>
          ) : null}

          <View style={styles.addRow}>
            <TextInput
              testID="grocery-add-input"
              keyboardAppearance={colors.dark ? 'dark' : 'light'}
              value={adding}
              onChangeText={setAdding}
              placeholder="Add an item"
              placeholderTextColor={colors.cocoaFaint}
              style={styles.input}
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={addItem}
              blurOnSubmit={false}
            />
            <Pressable
              testID="grocery-add"
              onPress={addItem}
              disabled={!adding.trim()}
              style={[styles.addBtn, !adding.trim() && { opacity: 0.4 }]}
              accessibilityLabel="Add"
            >
              <Ionicons name="add" size={22} color={colors.onAmber} />
            </Pressable>
          </View>
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
  side: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 70 },
  back: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: colors.hairline,
    marginHorizontal: spacing.lg,
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
  weekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  weekLabel: { fontFamily: fonts.display, fontSize: 17, color: colors.cocoa },
  error: { fontFamily: fonts.semi, fontSize: 13, color: colors.danger, marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  summary: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: 8 },
  summaryText: { fontFamily: fonts.semi, fontSize: 13.5, color: colors.cocoaSoft },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.creamDark, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.amber },
  noRecipe: {
    fontFamily: fonts.semi,
    fontSize: 13,
    lineHeight: 18,
    color: colors.cocoaFaint,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  section: {
    marginHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  aisle: { fontFamily: fonts.bold, fontSize: 13, color: colors.amberDark, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 9 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.cocoaFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  name: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  nameDone: { color: colors.cocoaFaint, textDecorationLine: 'line-through' },
  amount: { fontFamily: fonts.semi, fontSize: 14, color: colors.cocoaSoft },
  meals: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 1 },
  haveTag: { fontFamily: fonts.bold, fontSize: 12, color: colors.success },
  empty: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, paddingHorizontal: spacing.xl },
  emptyText: { fontFamily: fonts.semi, fontSize: 14.5, lineHeight: 20, color: colors.cocoaSoft, textAlign: 'center' },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontFamily: fonts.semi,
    fontSize: 15.5,
    color: colors.cocoa,
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
