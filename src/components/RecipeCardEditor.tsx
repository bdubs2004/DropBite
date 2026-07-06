import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, radius, spacing } from '../theme';
import { Ingredient } from '../types';
import { FormattedRecipe } from '../services/ai';
import { BittenCard } from './ui';

/**
 * The editable AI recipe card. HARD REQUIREMENT (CLAUDE.md): every field is
 * editable inline before posting; AI output is never shipped uncorrected.
 */
export function RecipeCardEditor({
  value,
  onChange,
  onRemove,
}: {
  value: FormattedRecipe;
  onChange: (next: FormattedRecipe) => void;
  onRemove: () => void;
}) {
  const setIngredient = (i: number, patch: Partial<Ingredient>) => {
    const ingredients = value.ingredients.map((ing, idx) =>
      idx === i ? { ...ing, ...patch } : ing,
    );
    onChange({ ...value, ingredients });
  };

  const setStep = (i: number, text: string) => {
    const steps = value.steps.map((s, idx) => (idx === i ? text : s));
    onChange({ ...value, steps });
  };

  return (
    <BittenCard>
      <View style={styles.topRow}>
        <Text style={styles.aiTag}>AI-formatted recipe. Tap any field to edit.</Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={styles.remove}>Remove</Text>
        </Pressable>
      </View>

      <TextInput
        value={value.title}
        onChangeText={(t) => onChange({ ...value, title: t })}
        style={styles.titleInput}
        placeholder="Recipe title"
        placeholderTextColor={colors.cocoaFaint}
      />

      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>Cook time</Text>
        <TextInput
          value={value.cook_time_minutes != null ? String(value.cook_time_minutes) : ''}
          onChangeText={(t) => {
            const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
            onChange({ ...value, cook_time_minutes: Number.isFinite(n) ? n : null });
          }}
          keyboardType="number-pad"
          style={styles.timeInput}
          placeholder="0"
          placeholderTextColor={colors.cocoaFaint}
        />
        <Text style={styles.timeLabel}>min</Text>
      </View>

      <Text style={styles.section}>Ingredients</Text>
      {value.ingredients.map((ing, i) => (
        <View key={i} style={styles.ingRow}>
          <TextInput
            value={ing.quantity}
            onChangeText={(t) => setIngredient(i, { quantity: t })}
            style={[styles.cell, styles.qty]}
            placeholder="qty"
            placeholderTextColor={colors.cocoaFaint}
          />
          <TextInput
            value={ing.unit}
            onChangeText={(t) => setIngredient(i, { unit: t })}
            style={[styles.cell, styles.unit]}
            placeholder="unit"
            placeholderTextColor={colors.cocoaFaint}
          />
          <TextInput
            value={ing.item}
            onChangeText={(t) => setIngredient(i, { item: t })}
            style={[styles.cell, styles.item]}
            placeholder="ingredient"
            placeholderTextColor={colors.cocoaFaint}
          />
          <Pressable
            onPress={() =>
              onChange({
                ...value,
                ingredients: value.ingredients.filter((_, idx) => idx !== i),
              })
            }
            hitSlop={8}
          >
            <Text style={styles.rowRemove}>×</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={() =>
          onChange({
            ...value,
            ingredients: [...value.ingredients, { item: '', quantity: '', unit: '' }],
          })
        }
      >
        <Text style={styles.addRow}>+ Add ingredient</Text>
      </Pressable>

      <Text style={styles.section}>Steps</Text>
      {value.steps.map((s, i) => (
        <View key={i} style={styles.ingRow}>
          <Text style={styles.stepNum}>{i + 1}.</Text>
          <TextInput
            value={s}
            onChangeText={(t) => setStep(i, t)}
            style={[styles.cell, styles.item]}
            multiline
            placeholder="step"
            placeholderTextColor={colors.cocoaFaint}
          />
          <Pressable
            onPress={() =>
              onChange({ ...value, steps: value.steps.filter((_, idx) => idx !== i) })
            }
            hitSlop={8}
          >
            <Text style={styles.rowRemove}>×</Text>
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => onChange({ ...value, steps: [...value.steps, ''] })}>
        <Text style={styles.addRow}>+ Add step</Text>
      </Pressable>
    </BittenCard>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingRight: 34, // clear the bitten corner
  },
  aiTag: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.amberDark,
  },
  remove: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.danger,
  },
  titleInput: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cocoa,
    borderBottomWidth: 1.5,
    borderColor: colors.creamDark,
    paddingVertical: 4,
    marginBottom: spacing.sm,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.cocoaSoft,
  },
  timeInput: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.cocoa,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 52,
    textAlign: 'center',
  },
  section: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: 6,
  },
  ingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  cell: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    paddingVertical: 7,
    fontFamily: fonts.semi,
    fontSize: 14,
    color: colors.cocoa,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  qty: { width: 52, textAlign: 'center' },
  unit: { width: 62, textAlign: 'center' },
  item: { flex: 1 },
  stepNum: {
    color: colors.amber,
    fontFamily: fonts.bold,
    fontSize: 14,
    minWidth: 18,
  },
  rowRemove: {
    color: colors.cocoaFaint,
    fontSize: 13,
    fontFamily: fonts.bold,
    paddingHorizontal: 2,
  },
  addRow: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.amberDark,
    marginTop: 4,
  },
});
