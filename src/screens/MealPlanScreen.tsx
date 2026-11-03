import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostThumb } from '../components/PostThumb';
import { addDays, dayKey, dayName, PLAN_SLOTS, shortDate, weekDays, weekLabel, weekStart } from '../lib/mealPlan';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { FamilyState, MealPlanItem, MealSlot } from '../types';

/** What a planned meal is called: its recipe, then the post's words, then the typed name. */
export function planItemTitle(item: MealPlanItem): string {
  return (
    item.post?.recipe?.title?.trim() ||
    item.post?.blurb?.trim().split('\n')[0] ||
    item.title?.trim() ||
    (item.post_id ? 'A post you can no longer see' : 'Meal')
  );
}

/**
 * The week's meals, day by day, breakfast to snack. Your own plan until you
 * join a family; then the family's shared one, where the admin's picks go
 * straight in and everyone else's wait for the admin. Members vote; the admin
 * has the last word either way.
 */
export function MealPlanScreen({ navigation }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const { user } = useApp();
  const today = dayKey(new Date());
  const [monday, setMonday] = useState(weekStart(today));
  const [items, setItems] = useState<MealPlanItem[]>([]);
  const [family, setFamily] = useState<FamilyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const [plan, fam] = await Promise.all([svc.getMealPlan(monday, addDays(monday, 6)), svc.getFamily()]);
      if (ticket !== latest.current) return;
      setItems(plan);
      setFamily(fam);
      setError(null);
    } catch (e: any) {
      if (ticket === latest.current) setError(e?.message ?? 'Could not load your plan');
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [svc, monday]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const goWeek = (n: number) => {
    setLoading(true);
    setItems([]);
    setMonday((m) => addDays(m, 7 * n));
  };

  /** Run a change, then reload; a refusal shows its own sentence. */
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save that');
    }
    load();
  };

  const inFamily = Boolean(family?.family);
  const amAdmin = Boolean(family?.am_admin);
  const adminName =
    family?.members.find((m) => m.is_admin)?.user.display_name?.split(' ')[0] ?? 'the admin';

  const vote = (it: MealPlanItem, yes: boolean) => {
    const next = it.my_vote === yes ? null : yes;
    // Show it straight away; the reload settles the counts.
    setItems((prev) =>
      prev.map((x) =>
        x.id !== it.id
          ? x
          : {
              ...x,
              my_vote: next,
              yes: x.yes - (x.my_vote === true ? 1 : 0) + (next === true ? 1 : 0),
              no: x.no - (x.my_vote === false ? 1 : 0) + (next === false ? 1 : 0),
            },
      ),
    );
    act(() => svc.votePlanItem(it.id, next));
  };

  const renderItem = (it: MealPlanItem) => {
    // Mirrors remove_plan_item: your own plan, the admin, or your own meal still waiting.
    const canRemove =
      !it.in_family || amAdmin || (it.status === 'pending' && it.added_by?.id === user?.id);
    const sub: string[] = [];
    const byMe = it.added_by?.id === user?.id;
    if (it.in_family && it.added_by) sub.push(byMe ? 'You' : it.added_by.display_name.split(' ')[0]);
    if (it.status === 'pending') sub.push(amAdmin ? 'Needs your OK' : `Waiting on ${adminName}`);
    if (it.yes) sub.push(`${it.yes} yes`);
    if (it.no) sub.push(`${it.no} no`);
    return (
      <View key={it.id} testID={`plan-item-${it.id}`} style={styles.item}>
        <Pressable
          onPress={() => it.post && navigation.navigate('PostDetail', { postId: it.post.id })}
          disabled={!it.post}
          style={styles.itemMain}
        >
          {it.post ? (
            <PostThumb post={it.post} style={styles.thumb} radius={radius.sm} showRecipeBadge={false} />
          ) : (
            <View style={[styles.thumb, styles.thumbBlank]}>
              <Ionicons name="restaurant-outline" size={16} color={colors.cocoaFaint} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.itemTitle, it.status === 'pending' && { color: colors.cocoaSoft }]}
              numberOfLines={1}
            >
              {planItemTitle(it)}
            </Text>
            {sub.length ? (
              <Text
                testID={`plan-item-sub-${it.id}`}
                style={[styles.itemSub, it.status === 'pending' && { color: colors.amberDark }]}
                numberOfLines={1}
              >
                {sub.join(' · ')}
              </Text>
            ) : null}
          </View>
        </Pressable>

        {/* The admin settles anything waiting or voted down; members vote. */}
        {it.in_family && amAdmin && (it.status === 'pending' || it.no > 0) ? (
          <View style={styles.actions}>
            <Pressable testID={`plan-keep-${it.id}`} onPress={() => act(() => svc.decidePlanItem(it.id, true))} style={styles.keep} hitSlop={4}>
              <Text style={styles.keepText}>Keep</Text>
            </Pressable>
            <Pressable testID={`plan-drop-${it.id}`} onPress={() => act(() => svc.decidePlanItem(it.id, false))} style={styles.drop} hitSlop={4}>
              <Text style={styles.dropText}>Drop</Text>
            </Pressable>
          </View>
        ) : it.in_family && !amAdmin && !byMe ? (
          <View style={styles.actions}>
            <Pressable testID={`plan-yes-${it.id}`} onPress={() => vote(it, true)} hitSlop={6} accessibilityLabel="Vote yes">
              <Ionicons
                name={it.my_vote === true ? 'thumbs-up' : 'thumbs-up-outline'}
                size={19}
                color={it.my_vote === true ? colors.success : colors.cocoaFaint}
              />
            </Pressable>
            <Pressable testID={`plan-no-${it.id}`} onPress={() => vote(it, false)} hitSlop={6} accessibilityLabel="Vote no">
              <Ionicons
                name={it.my_vote === false ? 'thumbs-down' : 'thumbs-down-outline'}
                size={19}
                color={it.my_vote === false ? colors.danger : colors.cocoaFaint}
              />
            </Pressable>
          </View>
        ) : null}
        {canRemove ? (
          <Pressable
            testID={`plan-remove-${it.id}`}
            onPress={() => act(() => svc.removePlanItem(it.id))}
            hitSlop={8}
            accessibilityLabel="Remove from plan"
            style={{ marginLeft: spacing.sm }}
          >
            <Ionicons name="close" size={18} color={colors.cocoaFaint} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  const add = (date: string, slot: MealSlot) => navigation.navigate('PlanPicker', { date, slot });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.side}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {family?.family?.name ?? 'Meal plan'}
        </Text>
        <Pressable
          testID="plan-family"
          onPress={() => navigation.navigate('Family')}
          hitSlop={10}
          style={[styles.side, { justifyContent: 'flex-end' }]}
          accessibilityLabel="Family"
        >
          <Ionicons name="people-outline" size={22} color={colors.cocoa} />
          {family?.invites.length ? <View style={styles.dot} /> : null}
        </Pressable>
      </View>

      <View style={styles.weekBar}>
        <Pressable testID="plan-prev-week" onPress={() => goWeek(-1)} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={colors.cocoaSoft} />
        </Pressable>
        <Text testID="plan-week-label" style={styles.weekLabel}>
          {weekLabel(monday, today)}
        </Text>
        <Pressable testID="plan-next-week" onPress={() => goWeek(1)} hitSlop={10}>
          <Ionicons name="chevron-forward" size={20} color={colors.cocoaSoft} />
        </Pressable>
      </View>

      {family?.invites.length && !inFamily ? (
        <Pressable testID="plan-invite-banner" onPress={() => navigation.navigate('Family')} style={styles.banner}>
          <Text style={styles.bannerText} numberOfLines={1}>
            {family.invites[0].invited_by?.display_name ?? 'Someone'} invited you to {family.invites[0].family.name}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.amberDark} />
        </Pressable>
      ) : null}

      {error ? (
        <Text testID="plan-error" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {loading && !items.length ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
          {weekDays(monday).map((day) => (
            <View key={day} testID={`plan-day-${day}`} style={styles.day}>
              <Text style={[styles.dayName, day === today && { color: colors.amberDark }]}>
                {dayName(day, today)}
                <Text style={styles.dayDate}>  {shortDate(day)}</Text>
              </Text>
              {PLAN_SLOTS.map((slot) => {
                const here = items.filter((i) => i.plan_date === day && i.meal_slot === slot);
                if (!here.length) return null;
                return (
                  <View key={slot} style={styles.slot}>
                    <View style={styles.slotHead}>
                      <Text style={[styles.slotName, { color: colors.meal[slot].color }]}>
                        {colors.meal[slot].label}
                      </Text>
                      <Pressable
                        testID={`plan-add-${day}-${slot}`}
                        onPress={() => add(day, slot)}
                        hitSlop={8}
                        accessibilityLabel={`Add ${slot} on ${dayName(day, today)}`}
                      >
                        <Ionicons name="add" size={20} color={colors.cocoaFaint} />
                      </Pressable>
                    </View>
                    {here.map(renderItem)}
                  </View>
                );
              })}
              {/* Meals with nothing planned yet sit on one line, one tap to fill. */}
              <View style={styles.empties}>
                {PLAN_SLOTS.filter((slot) => !items.some((i) => i.plan_date === day && i.meal_slot === slot)).map(
                  (slot) => (
                    <Pressable
                      key={slot}
                      testID={`plan-add-${day}-${slot}`}
                      onPress={() => add(day, slot)}
                      hitSlop={4}
                      accessibilityLabel={`Add ${slot} on ${dayName(day, today)}`}
                      style={styles.emptyChip}
                    >
                      <Ionicons name="add" size={14} color={colors.cocoaFaint} />
                      <Text style={styles.emptyText}>{colors.meal[slot].label}</Text>
                    </Pressable>
                  ),
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
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
  dot: {
    position: 'absolute',
    top: -1,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber,
  },
  weekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  weekLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  bannerText: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.amberDark },
  error: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.danger,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  day: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  dayName: { fontFamily: fonts.display, fontSize: 16, color: colors.cocoa, marginBottom: spacing.xs },
  dayDate: { fontFamily: fonts.semi, fontSize: 13, color: colors.cocoaFaint },
  slot: { paddingVertical: 3 },
  empties: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingTop: 4, paddingBottom: 2 },
  emptyChip: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  emptyText: { fontFamily: fonts.semi, fontSize: 13, color: colors.cocoaFaint },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  slotName: { fontFamily: fonts.bold, fontSize: 13 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 40, height: 40, borderRadius: radius.sm, overflow: 'hidden' },
  thumbBlank: { backgroundColor: colors.creamDark, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  itemSub: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginLeft: spacing.sm },
  keep: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.amber,
  },
  keepText: { fontFamily: fonts.bold, fontSize: 13, color: colors.onAmber },
  drop: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.creamDark,
  },
  dropText: { fontFamily: fonts.bold, fontSize: 13, color: colors.cocoa },
}));
