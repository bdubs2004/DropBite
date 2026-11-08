import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { buildGroceryList, itemKey } from '../lib/grocery';
import { addDays, dayKey, weekLabel, weekStart } from '../lib/mealPlan';
import { getDataService } from '../services';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { GroceryMark, Ingredient } from '../types';
import { planItemTitle } from './MealPlanScreen';

/**
 * "Add ingredients to your grocery list?" Asked right after a meal with a
 * recipe goes on the plan, and offered under any recipe you're looking at.
 * The recipe's ingredients are listed; tap anything you already have to cross
 * it off (making chicken and rice with rice in the cupboard: cross off rice).
 *
 * mode 'plan': the meal is on that week's plan, so its ingredients are on the
 *   list already; crossing off marks them "have it".
 * mode 'extra': a recipe that isn't planned; what you don't have is added to
 *   the week's list by hand, and anything the list already has is left alone.
 */
export function GroceryAddScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const { mode, meal, ingredients } = route.params as {
    mode: 'plan' | 'extra';
    meal: string;
    ingredients: Ingredient[];
  };
  const today = dayKey(new Date());
  const week = weekStart(route.params.week ?? today);

  // In the recipe's own order, so it reads like the card you're looking at.
  const lines = useMemo(() => {
    const order = ingredients.map((i) => itemKey(i.item ?? ''));
    return buildGroceryList([{ meal, ingredients }]).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }, [meal, ingredients]);
  const [marks, setMarks] = useState<GroceryMark[] | null>(null);
  const [onList, setOnList] = useState<Set<string>>(new Set());
  // Hand-added items are keyed on how they were written ("buttermilk (2 cups)");
  // this maps the ingredient ("buttermilk") to that row.
  const [customRow, setCustomRow] = useState<Map<string, string>>(new Map());
  const [crossed, setCrossed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [m, plan] = await Promise.all([
          svc.getGroceryMarks(week),
          mode === 'extra' ? svc.getMealPlan(week, addDays(week, 6)) : Promise.resolve([]),
        ]);
        if (!alive) return;
        // Already on the week's list: from a planned recipe, or added by hand.
        const planned = buildGroceryList(
          plan
            .filter((i) => i.status === 'in')
            .map((i) => ({
              meal: planItemTitle(i),
              ingredients: i.post?.recipe?.ingredients ?? i.recipe?.ingredients ?? [],
            })),
        ).map((l) => l.key);
        const customs = new Map(
          m.filter((x) => x.custom).map((x) => [itemKey(x.label ?? x.item_key), x.item_key] as [string, string]),
        );
        setCustomRow(customs);
        setOnList(new Set([...planned, ...customs.keys()]));
        setMarks(m);
        // What you already said you have starts crossed off.
        const haveKeys = new Set(
          m.filter((x) => x.have).map((x) => (x.custom ? itemKey(x.label ?? x.item_key) : x.item_key)),
        );
        setCrossed(new Set(lines.map((l) => l.key).filter((k) => haveKeys.has(k))));
      } catch (e: any) {
        if (alive) {
          setMarks([]);
          setError(e?.message ?? 'Could not load your grocery list');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [svc, week, mode, lines]);

  const flip = (key: string) =>
    setCrossed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const confirm = async () => {
    if (!marks || busy) return;
    setBusy(true);
    setError(null);
    try {
      const markOf = new Map(marks.map((m) => [m.item_key, m]));
      let added = 0;
      for (const l of lines) {
        const have = crossed.has(l.key);
        // The row it's on: a hand-added one, or the ingredient's own.
        const rowKey = customRow.get(l.key) ?? l.key;
        const m = markOf.get(rowKey);
        if (mode === 'plan' || onList.has(l.key)) {
          // On the list already: just record whether you have it.
          if ((m?.have ?? false) !== have) await svc.setGroceryItem(week, rowKey, have, m?.got ?? false);
          if (!have) added++;
        } else if (!have) {
          await svc.addGroceryItem(week, l.amount ? `${l.name} (${l.amount})` : l.name);
          added++;
        }
      }
      setDone(
        added === 0
          ? 'You have everything for this one'
          : `${added === 1 ? '1 thing' : `${added} things`} on your list for ${weekLabel(week, today).toLowerCase()}`,
      );
    } catch (e: any) {
      setError(e?.message ?? 'Could not update your list');
    } finally {
      setBusy(false);
    }
  };

  const left = lines.filter((l) => !crossed.has(l.key)).length;

  return (
    <View style={styles.root}>
      <Pressable testID="grocery-add-backdrop" style={styles.backdrop} onPress={() => navigation.goBack()} />
      <View testID="grocery-add-sheet" style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.grabber} />
        {done ? (
          <View style={{ gap: spacing.md, paddingVertical: spacing.sm }}>
            <View style={styles.doneRow}>
              <Ionicons name="checkmark-circle" size={24} color={colors.success} />
              <Text testID="grocery-add-done" style={styles.doneText}>
                {done}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                testID="grocery-add-open"
                title="See the list"
                variant="secondary"
                onPress={() => navigation.replace('Grocery', { week })}
                style={{ flex: 1 }}
              />
              <Button testID="grocery-add-close" title="Done" onPress={() => navigation.goBack()} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <>
            {route.params.addedNote ? (
              <View style={styles.addedRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text testID="grocery-add-note" style={styles.added}>
                  {route.params.addedNote}
                </Text>
              </View>
            ) : null}
            <Text style={styles.title}>Add ingredients to your grocery list?</Text>
            <Text style={styles.lead}>Tap anything you already have to cross it off</Text>

            {marks === null ? (
              <ActivityIndicator color={colors.amber} style={{ marginVertical: spacing.lg }} />
            ) : (
              <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: spacing.sm }}>
                {lines.map((l) => {
                  const on = crossed.has(l.key);
                  const already = mode === 'extra' && onList.has(l.key);
                  return (
                    <Pressable
                      key={l.key}
                      testID={`grocery-add-item-${l.key}`}
                      onPress={() => flip(l.key)}
                      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${l.name}${on ? ', you have it' : ''}`}
                    >
                      <View style={[styles.box, on && styles.boxOn]}>
                        {on ? <Ionicons name="checkmark" size={15} color={colors.onAmber} /> : null}
                      </View>
                      <Text style={[styles.name, on && styles.nameCrossed]} numberOfLines={2}>
                        {l.name}
                        {l.amount ? <Text style={styles.amount}>  {l.amount}</Text> : null}
                      </Text>
                      {on ? (
                        <Text style={styles.tag}>Have it</Text>
                      ) : already ? (
                        <Text style={styles.tagFaint}>On your list</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {error ? (
              <Text testID="grocery-add-error" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button
                testID="grocery-add-skip"
                title="Not now"
                variant="secondary"
                onPress={() => navigation.goBack()}
                style={{ flex: 1 }}
              />
              <Button
                testID="grocery-add-confirm"
                title={left === lines.length ? 'Add to list' : `Add ${left} to list`}
                onPress={confirm}
                loading={busy}
                disabled={marks === null}
                style={{ flex: 1.4 }}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors, { shadow }) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
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
    marginBottom: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 19, color: colors.cocoa },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  added: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.success },
  lead: { fontFamily: fonts.semi, fontSize: 14, color: colors.cocoaSoft, marginTop: 4, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.cocoaFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  name: { flex: 1, fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  nameCrossed: { color: colors.cocoaFaint, textDecorationLine: 'line-through' },
  amount: { fontFamily: fonts.semi, fontSize: 14, color: colors.cocoaSoft },
  tag: { fontFamily: fonts.bold, fontSize: 12, color: colors.success },
  tagFaint: { fontFamily: fonts.semi, fontSize: 12, color: colors.cocoaFaint },
  error: { fontFamily: fonts.semi, fontSize: 13, color: colors.danger, marginTop: spacing.sm },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  doneText: { flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.cocoa },
}));
