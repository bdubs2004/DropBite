import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Nutrition,
  NutritionSource,
  perServing,
  roundForDisplay,
  servingFractionLabel,
} from '../lib/nutrition';
import { colors, fonts, radius, spacing } from '../theme';

/**
 * The nutrition label, with the serving-size control that makes it mean
 * anything.
 *
 * `total` is always the whole dish. Everything shown here is that divided by
 * `servings` — which the user sets, because nothing else can know that a pie
 * feeds four. Getting it wrong by 4x produces a number that looks entirely
 * reasonable, so the control is prominent rather than tucked away.
 */
export function NutritionPanel({
  total,
  servings,
  source,
  unmatched = [],
  loading = false,
  editable = false,
  onChangeServings,
  onRecalculate,
}: {
  total: Nutrition | null;
  servings: number;
  source: NutritionSource | null;
  unmatched?: string[];
  loading?: boolean;
  editable?: boolean;
  onChangeServings?: (n: number) => void;
  onRecalculate?: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Nutrition</Text>
        </View>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.amber} />
          <Text style={styles.loadingText}>Working out the numbers</Text>
        </View>
      </View>
    );
  }

  if (!total) {
    if (!editable) return null;
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Nutrition</Text>
        </View>
        <Text style={styles.emptyText}>
          Add a nutrition estimate from your ingredients.
        </Text>
        <Pressable testID="nutrition-calculate" onPress={onRecalculate} style={styles.calcBtn}>
          <Ionicons name="calculator-outline" size={16} color={colors.white} />
          <Text style={styles.calcBtnText}>Estimate nutrition</Text>
        </Pressable>
      </View>
    );
  }

  const each = roundForDisplay(perServing(total, servings));

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Nutrition</Text>
        <Text style={styles.perServing}>per serving</Text>
      </View>

      {editable ? (
        <View style={styles.servingsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.servingsLabel}>This recipe makes</Text>
            <Text style={styles.servingsHint}>
              One serving is {servingFractionLabel(servings)}
            </Text>
          </View>
          <View style={styles.stepper}>
            <Pressable
              testID="servings-minus"
              onPress={() => onChangeServings?.(Math.max(1, servings - 1))}
              disabled={servings <= 1}
              hitSlop={8}
              style={[styles.stepBtn, servings <= 1 && { opacity: 0.35 }]}
            >
              <Ionicons name="remove" size={18} color={colors.cocoa} />
            </Pressable>
            <Text testID="servings-value" style={styles.stepValue}>
              {servings}
            </Text>
            <Pressable
              testID="servings-plus"
              onPress={() => onChangeServings?.(Math.min(100, servings + 1))}
              disabled={servings >= 100}
              hitSlop={8}
              style={[styles.stepBtn, servings >= 100 && { opacity: 0.35 }]}
            >
              <Ionicons name="add" size={18} color={colors.cocoa} />
            </Pressable>
          </View>
        </View>
      ) : (
        <Text style={styles.servingsHint}>
          Serves {servings} — one serving is {servingFractionLabel(servings)}
        </Text>
      )}

      <View style={styles.calorieRow}>
        <Text testID="nutrition-calories" style={styles.calories}>
          {each.calories}
        </Text>
        <Text style={styles.calorieUnit}>calories</Text>
      </View>

      <View style={styles.macros}>
        <Macro label="Protein" value={`${each.protein_g} g`} testID="macro-protein" />
        <Macro label="Carbs" value={`${each.carbs_g} g`} testID="macro-carbs" />
        <Macro label="Fat" value={`${each.fat_g} g`} testID="macro-fat" />
      </View>
      <View style={styles.macros}>
        <Macro label="Fiber" value={`${each.fiber_g} g`} />
        <Macro label="Sugar" value={`${each.sugar_g} g`} />
        <Macro label="Sodium" value={`${each.sodium_mg} mg`} />
      </View>

      {unmatched.length > 0 ? (
        <Text testID="nutrition-unmatched" style={styles.warning}>
          Not counted: {unmatched.slice(0, 4).join(', ')}
          {unmatched.length > 4 ? ` and ${unmatched.length - 4} more` : ''}.
        </Text>
      ) : null}

      <Text style={styles.source}>{sourceLine(source)}</Text>

      {editable ? (
        <Pressable testID="nutrition-recalculate" onPress={onRecalculate} hitSlop={6}>
          <Text style={styles.recalc}>Recalculate from ingredients</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Say where the numbers came from, in the user's words.
 *
 * "Estimate" is doing real work in every one of these: an ingredient list
 * cannot tell you how much oil stayed in the pan.
 */
function sourceLine(source: NutritionSource | null): string {
  switch (source) {
    case 'usda':
      return 'Estimated from your ingredients using USDA FoodData Central. Cooking, brands and how much you actually eat will move these numbers.';
    case 'demo':
      return 'Sample data for demo mode — not real nutrition figures.';
    case 'estimated':
      return 'A rough estimate, not matched to a nutrition database. Treat it as a ballpark.';
    default:
      return 'An estimate. Do not rely on it for medical or dietary decisions.';
  }
}

function Macro({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.macro}>
      <Text testID={testID} style={styles.macroValue}>
        {value}
      </Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: { fontFamily: fonts.display, fontSize: 16, color: colors.cocoa },
  perServing: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.cocoaFaint, textTransform: 'uppercase', letterSpacing: 0.6 },
  servingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  servingsLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoa },
  servingsHint: { fontFamily: fonts.semi, fontSize: 12, color: colors.cocoaFaint, marginTop: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  stepValue: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa, minWidth: 26, textAlign: 'center' },
  calorieRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  calories: { fontFamily: fonts.display, fontSize: 34, color: colors.amberDark },
  calorieUnit: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoaSoft },
  macros: { flexDirection: 'row', marginTop: spacing.sm },
  macro: { flex: 1 },
  macroValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  macroLabel: { fontFamily: fonts.semi, fontSize: 11.5, color: colors.cocoaFaint },
  warning: {
    fontFamily: fonts.semi, fontSize: 12, color: colors.cocoaSoft,
    marginTop: spacing.md, lineHeight: 17,
  },
  source: {
    fontFamily: fonts.semi, fontSize: 11.5, color: colors.cocoaFaint,
    marginTop: spacing.sm, lineHeight: 16,
  },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  loadingText: { fontFamily: fonts.semi, fontSize: 13.5, color: colors.cocoaFaint },
  emptyText: { fontFamily: fonts.semi, fontSize: 13.5, color: colors.cocoaFaint, marginBottom: spacing.md },
  calcBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.amber, borderRadius: radius.pill, paddingVertical: 10,
  },
  calcBtnText: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
  recalc: {
    fontFamily: fonts.bold, fontSize: 12.5, color: colors.amberDark,
    marginTop: spacing.md, textAlign: 'center',
  },
});
