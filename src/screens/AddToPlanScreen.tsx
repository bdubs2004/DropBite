import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { addDays, dayKey, dayName, fromKey, nextSlot, PLAN_SLOTS } from '../lib/mealPlan';
import { getDataService } from '../services';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { FamilyState, MealSlot } from '../types';

const DAYS_AHEAD = 14;

/** "Today", "Tomorrow", then "Wed 11". */
function chipLabel(key: string, today: string): string {
  const name = dayName(key, today);
  if (name === 'Today' || name === 'Tomorrow') return name;
  return `${name.slice(0, 3)} ${fromKey(key).getDate()}`;
}

/**
 * "Add to meal plan" for one post, from its ··· menu or the share sheet: pick a
 * day and a meal. On a family plan a member's pick waits for the admin, and
 * the sheet says so.
 */
export function AddToPlanScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const postId: string = route.params.postId;
  const now = new Date();
  const today = dayKey(now);
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

  const [day, setDay] = useState(today);
  const [slot, setSlot] = useState<MealSlot>(nextSlot(now.getHours()));
  const [family, setFamily] = useState<FamilyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    svc.getFamily().then(setFamily, () => {});
  }, [svc]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await svc.addPlanItem({ date: day, slot, postId });
      const admin = family?.members.find((m) => m.is_admin)?.user.display_name?.split(' ')[0];
      const where = `${dayName(day, today)} ${colors.meal[slot].label.toLowerCase()}`;
      setDone(
        family?.family && !family.am_admin
          ? `Sent to ${admin ?? 'the admin'} for ${where}`
          : `Added to ${where}`,
      );
    } catch (e: any) {
      setError(e?.message ?? 'Could not add that meal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Pressable testID="plan-sheet-backdrop" style={styles.backdrop} onPress={() => navigation.goBack()} />
      <View testID="plan-sheet" style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.grabber} />
        <View style={styles.head}>
          <Text style={styles.title}>{family?.family ? `Add to ${family.family.name}` : 'Add to meal plan'}</Text>
          <Pressable testID="plan-sheet-close" onPress={() => navigation.goBack()} hitSlop={10}>
            <Text style={styles.done}>{done ? 'Done' : 'Cancel'}</Text>
          </Pressable>
        </View>

        {done ? (
          <View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
            <Text testID="plan-sheet-done" style={styles.doneText}>
              {done}
            </Text>
            <Button
              testID="plan-sheet-open"
              title="See the plan"
              variant="secondary"
              onPress={() => navigation.replace('MealPlan')}
            />
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {days.map((d) => (
                <Pressable
                  key={d}
                  testID={`plan-day-chip-${d}`}
                  onPress={() => setDay(d)}
                  style={[styles.chip, d === day && styles.chipOn]}
                >
                  <Text style={[styles.chipText, d === day && styles.chipTextOn]}>{chipLabel(d, today)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.slots}>
              {PLAN_SLOTS.map((s) => (
                <Pressable
                  key={s}
                  testID={`plan-slot-${s}`}
                  onPress={() => setSlot(s)}
                  style={[styles.chip, styles.slotChip, s === slot && styles.chipOn]}
                >
                  <Text style={[styles.chipText, s === slot && styles.chipTextOn]}>{colors.meal[s].label}</Text>
                </Pressable>
              ))}
            </View>
            {error ? (
              <Text testID="plan-sheet-error" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Button testID="plan-sheet-add" title="Add" onPress={add} loading={busy} />
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
    gap: spacing.md,
    ...(shadow as object),
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.creamDark,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 19, color: colors.cocoa },
  done: { fontFamily: fonts.bold, fontSize: 15, color: colors.amberDark },
  chips: { gap: spacing.sm },
  slots: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.creamDark,
  },
  slotChip: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  chipOn: { backgroundColor: colors.cocoa },
  chipText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoa },
  chipTextOn: { color: colors.cream },
  error: { fontFamily: fonts.semi, fontSize: 13, color: colors.danger },
  doneText: { fontFamily: fonts.bold, fontSize: 16, color: colors.cocoa },
}));
