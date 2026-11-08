import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostThumb } from '../components/PostThumb';
import {
  addDays,
  addMonths,
  dayKey,
  fromKey,
  longDay,
  monthGrid,
  monthLabel,
  monthStart,
  PLAN_SLOTS,
  weekDays,
  weekLabel,
  weekStart,
} from '../lib/mealPlan';
import { recipeSummary } from '../lib/myRecipe';
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

type PlanView = 'day' | 'week' | 'month';
const VIEWS: { key: PlanView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];
const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CELL = Math.floor((Dimensions.get('window').width - spacing.lg * 2) / 7);
const WEEK_THUMBS = 5;

const slotOrder = (s: MealSlot) => PLAN_SLOTS.indexOf(s);

/** The meal slots that have something planned, in breakfast-to-snack order. */
function slotsOf(items: MealPlanItem[] | undefined): MealSlot[] {
  return PLAN_SLOTS.filter((s) => items?.some((i) => i.meal_slot === s));
}

/**
 * The meal plan, three ways: a Day with each meal laid out, a Week of days at
 * a glance (photos, not words), and a Month calendar where a day with meals
 * carries a dot for each meal (breakfast, lunch, dinner, snack colors). Tap
 * any day in Week or Month to open it.
 *
 * Your own plan until you join a family; then the family's shared one, where
 * the admin's picks go straight in and everyone else's wait for the admin.
 * Members vote; the admin has the last word either way.
 */
export function MealPlanScreen({ navigation }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const { user } = useApp();
  const today = dayKey(new Date());
  const [view, setView] = useState<PlanView>('week');
  const [selected, setSelected] = useState(today);
  const [items, setItems] = useState<MealPlanItem[]>([]);
  const [family, setFamily] = useState<FamilyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  // What's on screen decides what to fetch: the month's whole grid, or the week.
  const [from, to] = useMemo(() => {
    if (view === 'month') {
      const grid = monthGrid(selected);
      return [grid[0], grid[grid.length - 1]];
    }
    const mon = weekStart(selected);
    return [mon, addDays(mon, 6)];
  }, [view, selected]);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const [plan, fam] = await Promise.all([svc.getMealPlan(from, to), svc.getFamily()]);
      if (ticket !== latest.current) return;
      setItems(plan);
      setFamily(fam);
      setError(null);
    } catch (e: any) {
      if (ticket === latest.current) setError(e?.message ?? 'Could not load your plan');
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [svc, from, to]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const byDay = useMemo(() => {
    const m = new Map<string, MealPlanItem[]>();
    for (const it of [...items].sort((a, b) => slotOrder(a.meal_slot) - slotOrder(b.meal_slot))) {
      const list = m.get(it.plan_date) ?? [];
      list.push(it);
      m.set(it.plan_date, list);
    }
    return m;
  }, [items]);

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

  const openDay = (day: string) => {
    setSelected(day);
    setView('day');
  };

  /** The arrows step a day, a week or a month, by view. */
  const step = (n: number) => {
    setSelected((d) => (view === 'day' ? addDays(d, n) : view === 'week' ? addDays(d, 7 * n) : addMonths(d, n)));
  };
  const periodLabel =
    view === 'day'
      ? selected === today
        ? `Today, ${longDay(selected).split(', ')[1]}`
        : longDay(selected)
      : view === 'week'
        ? weekLabel(weekStart(selected), today)
        : monthLabel(selected);
  const showingToday =
    view === 'day'
      ? selected === today
      : view === 'week'
        ? weekStart(selected) === weekStart(today)
        : monthStart(selected) === monthStart(today);

  const add = (date: string, slot: MealSlot) => navigation.navigate('PlanPicker', { date, slot });

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
    if (!sub.length && it.post?.recipe?.cook_time_minutes) sub.push(`${it.post.recipe.cook_time_minutes} min`);
    if (!sub.length && it.recipe && recipeSummary(it.recipe)) sub.push(recipeSummary(it.recipe));
    // Just a name so far, and yours to change (mirrors set_plan_item_recipe):
    // it can get a recipe card or the ingredients it needs.
    const canGiveRecipe =
      !it.post && !it.recipe && (!it.in_family || amAdmin || it.added_by?.id === user?.id);
    const giveRecipe = () =>
      navigation.navigate('PlanRecipeNew', { itemId: it.id, mealTitle: planItemTitle(it) });
    // A post opens the post; a meal with a recipe of its own opens the recipe.
    const open = it.post
      ? () => navigation.navigate('PostDetail', { postId: it.post!.id })
      : it.recipe
        ? () => navigation.navigate('PlanRecipe', { recipe: it.recipe })
        : canGiveRecipe
          ? giveRecipe
          : null;
    return (
      <View key={it.id} testID={`plan-item-${it.id}`} style={styles.item}>
        <Pressable
          testID={`plan-open-${it.id}`}
          onPress={() => open?.()}
          disabled={!open}
          style={styles.itemMain}
        >
          <MealThumb item={it} size={52} />
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.itemTitle, it.status === 'pending' && { color: colors.cocoaSoft }]}
              numberOfLines={2}
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
            {canGiveRecipe ? (
              <Text testID={`plan-add-recipe-${it.id}`} style={styles.addRecipe}>
                + Recipe or ingredients
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
                size={20}
                color={it.my_vote === true ? colors.success : colors.cocoaFaint}
              />
            </Pressable>
            <Pressable testID={`plan-no-${it.id}`} onPress={() => vote(it, false)} hitSlop={6} accessibilityLabel="Vote no">
              <Ionicons
                name={it.my_vote === false ? 'thumbs-down' : 'thumbs-down-outline'}
                size={20}
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

  const dayItems = byDay.get(selected) ?? [];

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
        <View style={[styles.side, { justifyContent: 'flex-end', gap: spacing.md }]}>
          <Pressable
            testID="plan-grocery"
            onPress={() => navigation.navigate('Grocery', { week: weekStart(selected) })}
            hitSlop={8}
            accessibilityLabel="Grocery list"
          >
            <Ionicons name="cart-outline" size={23} color={colors.cocoa} />
          </Pressable>
          <Pressable
            testID="plan-family"
            onPress={() => navigation.navigate('Family')}
            hitSlop={8}
            accessibilityLabel="Family"
          >
            <Ionicons name="people-outline" size={22} color={colors.cocoa} />
            {family?.invites.length ? <View style={styles.badge} /> : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.tabs}>
        {VIEWS.map((v) => (
          <Pressable
            key={v.key}
            testID={`plan-view-${v.key}`}
            onPress={() => setView(v.key)}
            style={[styles.tab, view === v.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, view === v.key && styles.tabTextActive]}>{v.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.periodBar}>
        <Pressable testID="plan-prev" onPress={() => step(-1)} hitSlop={10} accessibilityLabel="Back one">
          <Ionicons name="chevron-back" size={20} color={colors.cocoaSoft} />
        </Pressable>
        <View style={styles.periodMid}>
          <Text testID="plan-period-label" style={styles.periodLabel} numberOfLines={1}>
            {periodLabel}
          </Text>
          {!showingToday ? (
            <Pressable testID="plan-today" onPress={() => setSelected(today)} hitSlop={8}>
              <Text style={styles.todayLink}>Today</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable testID="plan-next" onPress={() => step(1)} hitSlop={10} accessibilityLabel="Forward one">
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
          {view === 'day' ? (
            <>
              <DayStrip days={weekDays(weekStart(selected))} selected={selected} today={today} byDay={byDay} onPick={setSelected} />
              <View testID={`plan-day-${selected}`}>
                {PLAN_SLOTS.map((slot) => {
                  const here = dayItems.filter((i) => i.meal_slot === slot);
                  const meta = colors.meal[slot];
                  return (
                    <View key={slot} style={styles.slot}>
                      <View style={styles.slotHead}>
                        <View style={[styles.slotDot, { backgroundColor: meta.color }]} />
                        <Text style={styles.slotName}>{meta.label}</Text>
                        {here.length ? (
                          <Pressable
                            testID={`plan-add-${selected}-${slot}`}
                            onPress={() => add(selected, slot)}
                            hitSlop={8}
                            accessibilityLabel={`Add ${slot}`}
                            style={{ marginLeft: 'auto' }}
                          >
                            <Ionicons name="add" size={22} color={colors.cocoaSoft} />
                          </Pressable>
                        ) : null}
                      </View>
                      {here.length ? (
                        here.map(renderItem)
                      ) : (
                        <Pressable
                          testID={`plan-add-${selected}-${slot}`}
                          onPress={() => add(selected, slot)}
                          style={({ pressed }) => [styles.emptySlot, pressed && { opacity: 0.6 }]}
                        >
                          <Ionicons name="add" size={18} color={colors.cocoaFaint} />
                          <Text style={styles.emptyText}>Add {meta.label.toLowerCase()}</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          ) : view === 'week' ? (
            weekDays(weekStart(selected)).map((day, i) => (
              <WeekRow
                key={day}
                day={day}
                weekday={WEEKDAY_SHORT[i]}
                isToday={day === today}
                items={byDay.get(day) ?? []}
                onPress={() => openDay(day)}
              />
            ))
          ) : (
            <MonthGrid selected={selected} today={today} byDay={byDay} onPick={openDay} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** A meal's picture: the post's photo, or a tile in its meal's color. */
function MealThumb({ item, size }: { item: MealPlanItem; size: number }) {
  const styles = useStyles();
  const colors = useColors();
  const meta = colors.meal[item.meal_slot];
  const box = { width: size, height: size, borderRadius: radius.sm };
  return item.post ? (
    <PostThumb post={item.post} style={{ ...box, overflow: 'hidden' }} radius={radius.sm} showRecipeBadge={false} />
  ) : (
    <View style={[styles.thumbBlank, box, { backgroundColor: meta.bg }]}>
      <Ionicons name={item.recipe ? 'book' : 'restaurant'} size={Math.round(size * 0.38)} color={meta.color} />
    </View>
  );
}

/** A dot per meal that day has, in its meal's color. */
function SlotDots({ items, testID }: { items: MealPlanItem[] | undefined; testID?: string }) {
  const styles = useStyles();
  const colors = useColors();
  const slots = slotsOf(items);
  return (
    <View testID={slots.length ? testID : undefined} style={styles.dots}>
      {slots.map((s) => (
        <View key={s} style={[styles.dotSmall, { backgroundColor: colors.meal[s].color }]} />
      ))}
    </View>
  );
}

/** The week across the top of Day view: tap a day to see it. */
function DayStrip({
  days,
  selected,
  today,
  byDay,
  onPick,
}: {
  days: string[];
  selected: string;
  today: string;
  byDay: Map<string, MealPlanItem[]>;
  onPick: (day: string) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.strip}>
      {days.map((d, i) => {
        const on = d === selected;
        return (
          <Pressable key={d} testID={`plan-strip-${d}`} onPress={() => onPick(d)} style={styles.stripCell}>
            <Text style={styles.stripLetter}>{WEEKDAY_LETTERS[i]}</Text>
            <View style={[styles.num, on && styles.numOn, !on && d === today && styles.numToday]}>
              <Text style={[styles.numText, on && styles.numTextOn, !on && d === today && styles.numTextToday]}>
                {fromKey(d).getDate()}
              </Text>
            </View>
            <SlotDots items={byDay.get(d)} testID={`plan-dots-${d}`} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** One day in Week view: the date, then the day's meals as pictures. */
function WeekRow({
  day,
  weekday,
  isToday,
  items,
  onPress,
}: {
  day: string;
  weekday: string;
  isToday: boolean;
  items: MealPlanItem[];
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const shown = items.slice(0, WEEK_THUMBS);
  const more = items.length - shown.length;
  const waiting = items.filter((i) => i.status === 'pending').length;
  return (
    <Pressable
      testID={`plan-week-row-${day}`}
      onPress={onPress}
      style={({ pressed }) => [styles.weekRow, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.dateBlock}>
        <Text style={[styles.dateWeekday, isToday && { color: colors.amberDark }]}>{weekday}</Text>
        <Text style={[styles.dateNum, isToday && { color: colors.amberDark }]}>{fromKey(day).getDate()}</Text>
      </View>
      <View style={styles.weekMeals}>
        {items.length ? (
          <>
            <View style={styles.thumbRow}>
              {shown.map((it) => (
                <View key={it.id} style={it.status === 'pending' && { opacity: 0.5 }}>
                  <MealThumb item={it} size={44} />
                  <View style={[styles.slotBar, { backgroundColor: colors.meal[it.meal_slot].color }]} />
                </View>
              ))}
              {more > 0 ? <Text style={styles.more}>+{more}</Text> : null}
              {/* One meal: say what it is too. */}
              {items.length === 1 ? (
                <Text style={styles.oneTitle} numberOfLines={2}>
                  {planItemTitle(items[0])}
                </Text>
              ) : null}
            </View>
            {waiting ? (
              <Text style={styles.waiting}>{waiting === 1 ? '1 waiting' : `${waiting} waiting`}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.nothing}>Nothing planned</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.cocoaFaint} />
    </Pressable>
  );
}

/** The month as a calendar: a dot per meal on each day that has one. */
function MonthGrid({
  selected,
  today,
  byDay,
  onPick,
}: {
  selected: string;
  today: string;
  byDay: Map<string, MealPlanItem[]>;
  onPick: (day: string) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const month = monthStart(selected).slice(0, 7);
  const grid = monthGrid(selected);
  const planned = grid.filter((d) => d.startsWith(month) && byDay.has(d)).length;
  return (
    <View style={styles.month}>
      <View style={styles.monthHead}>
        {WEEKDAY_LETTERS.map((l, i) => (
          <Text key={i} style={[styles.monthHeadText, { width: CELL }]}>
            {l}
          </Text>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {grid.map((d) => {
          const inMonth = d.startsWith(month);
          const isToday = d === today;
          return (
            <Pressable
              key={d}
              testID={`plan-cal-${d}`}
              onPress={() => onPick(d)}
              style={({ pressed }) => [styles.calCell, { width: CELL }, pressed && { opacity: 0.6 }]}
            >
              <View style={[styles.num, isToday && styles.numToday]}>
                <Text style={[styles.numText, !inMonth && { color: colors.cocoaFaint, opacity: 0.5 }, isToday && styles.numTextToday]}>
                  {fromKey(d).getDate()}
                </Text>
              </View>
              <SlotDots items={byDay.get(d)} testID={`plan-dots-${d}`} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.legend}>
        {PLAN_SLOTS.map((s) => (
          <View key={s} style={styles.legendItem}>
            <View style={[styles.dotSmall, { backgroundColor: colors.meal[s].color }]} />
            <Text style={styles.legendText}>{colors.meal[s].label}</Text>
          </View>
        ))}
      </View>
      <Text testID="plan-month-count" style={styles.monthCount}>
        {planned === 0 ? 'Nothing planned this month yet' : planned === 1 ? '1 day planned' : `${planned} days planned`}
      </Text>
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
  badge: {
    position: 'absolute',
    top: -1,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber,
  },
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
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  periodMid: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexShrink: 1 },
  periodLabel: { fontFamily: fonts.display, fontSize: 17, color: colors.cocoa, flexShrink: 1 },
  todayLink: { fontFamily: fonts.bold, fontSize: 13, color: colors.amberDark },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  bannerText: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.amberDark },
  error: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.danger,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },

  // Day
  strip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  stripCell: { alignItems: 'center', width: CELL, gap: 4 },
  stripLetter: { fontFamily: fonts.bold, fontSize: 12, color: colors.cocoaFaint },
  num: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  numOn: { backgroundColor: colors.cocoa },
  numToday: { borderWidth: 1.5, borderColor: colors.amber },
  numText: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  numTextOn: { color: colors.cream },
  numTextToday: { color: colors.amberDark },
  dots: { flexDirection: 'row', gap: 3, height: 6, alignItems: 'center', justifyContent: 'center' },
  dotSmall: { width: 6, height: 6, borderRadius: 3 },
  slot: {
    marginHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  slotDot: { width: 8, height: 8, borderRadius: 4 },
  slotName: { fontFamily: fonts.display, fontSize: 16, color: colors.cocoa },
  emptySlot: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  emptyText: { fontFamily: fonts.semi, fontSize: 14.5, color: colors.cocoaFaint },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumbBlank: { alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, color: colors.cocoa },
  addRecipe: { fontFamily: fonts.bold, fontSize: 13, color: colors.amberDark, marginTop: 3 },
  itemSub: { fontFamily: fonts.semi, fontSize: 13, color: colors.cocoaFaint, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginLeft: spacing.sm },
  keep: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.amber,
  },
  keepText: { fontFamily: fonts.bold, fontSize: 13, color: colors.onAmber },
  drop: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.creamDark,
  },
  dropText: { fontFamily: fonts.bold, fontSize: 13, color: colors.cocoa },

  // Week
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
    minHeight: 76,
  },
  dateBlock: { width: 40, alignItems: 'center' },
  dateWeekday: { fontFamily: fonts.bold, fontSize: 12, color: colors.cocoaFaint },
  dateNum: { fontFamily: fonts.display, fontSize: 22, color: colors.cocoa, marginTop: -1 },
  weekMeals: { flex: 1 },
  thumbRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slotBar: { height: 3, borderRadius: 2, marginTop: 3, marginHorizontal: 6 },
  oneTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.cocoa, marginLeft: 6 },
  more: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoaSoft, marginLeft: 2 },
  waiting: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.amberDark, marginTop: 4 },
  nothing: { fontFamily: fonts.semi, fontSize: 14, color: colors.cocoaFaint },

  // Month
  month: { paddingHorizontal: spacing.lg },
  monthHead: { flexDirection: 'row', paddingBottom: spacing.sm },
  monthHeadText: { textAlign: 'center', fontFamily: fonts.bold, fontSize: 12, color: colors.cocoaFaint },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { alignItems: 'center', gap: 3, paddingVertical: 5, minHeight: 54 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaSoft },
  monthCount: {
    textAlign: 'center',
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.cocoaFaint,
    marginTop: spacing.md,
  },
}));
