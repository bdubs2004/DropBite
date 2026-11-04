import React from 'react';
import { Text, View } from 'react-native';
import { fonts, spacing, makeStyles } from '../theme';
import { Recipe } from '../types';
import { NutritionPanel } from './NutritionPanel';

/**
 * The recipe under a post, opened from its title. Not a floating card: a
 * full-width section of its own, on a slightly different paper with a rule
 * above and below, so it reads as part of the post but clearly its own part,
 * like the recipe block in a cooking magazine.
 */
export function RecipeCardView({ recipe }: { recipe: Recipe }) {
  const styles = useStyles();
  const meta = [
    recipe.cook_time_minutes ? formatTime(recipe.cook_time_minutes) : null,
    recipe.ingredients.length ? `${recipe.ingredients.length} ingredients` : null,
    recipe.ai_generated ? `AI-formatted${recipe.user_edited ? ', edited' : ''}` : null,
  ].filter(Boolean);
  return (
    <View testID="recipe-section" style={styles.sheet}>
      <Text style={styles.kicker}>Recipe</Text>
      <Text style={styles.title}>{recipe.title}</Text>
      {meta.length ? <Text style={styles.meta}>{meta.join('  ·  ')}</Text> : null}

      {recipe.ingredients.length ? (
        <View style={styles.block}>
          <Text style={styles.section}>Ingredients</Text>
          {recipe.ingredients.map((ing, i) => (
            <View key={i} style={styles.ingRow}>
              <View style={styles.dot} />
              <Text style={styles.ingText}>
                {ing.quantity || ing.unit ? (
                  <Text style={styles.qty}>{[ing.quantity, ing.unit].filter(Boolean).join(' ')} </Text>
                ) : null}
                {ing.item}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {recipe.steps.length ? (
        <View style={styles.block}>
          <Text style={styles.section}>Steps</Text>
          {recipe.steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <Text style={styles.stepNum}>{i + 1}</Text>
              <Text style={styles.ingText}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Read-only: the poster already chose the serving count. */}
      {recipe.nutrition ? (
        <View style={styles.block}>
          <NutritionPanel
            total={recipe.nutrition}
            servings={recipe.servings ?? 1}
            source={recipe.nutrition_source ?? null}
          />
        </View>
      ) : null}
    </View>
  );
}

export function formatTime(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const useStyles = makeStyles((colors) => ({
  // Edge to edge across the post (it cancels the post's side padding), on
  // its own paper, ruled off top and bottom.
  sheet: {
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: colors.dark ? colors.card : colors.creamDark,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  kicker: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    color: colors.amberDark,
    marginBottom: 2,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 21,
    lineHeight: 27,
    color: colors.cocoa,
  },
  meta: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.cocoaSoft,
    marginTop: 4,
  },
  block: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  section: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.cocoa,
    marginBottom: 8,
  },
  ingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.amber,
    marginTop: 8,
    marginRight: 10,
  },
  qty: { fontFamily: fonts.bold, color: colors.cocoa },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  stepNum: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 21,
    color: colors.amberDark,
    minWidth: 20,
  },
  ingText: {
    fontFamily: fonts.semi,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.cocoa,
    flex: 1,
  },
}));
