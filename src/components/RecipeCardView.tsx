import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing } from '../theme';
import { Recipe } from '../types';
import { BittenCard } from './ui';

/** Read-only recipe card shown on feed posts. */
export function RecipeCardView({ recipe }: { recipe: Recipe }) {
  return (
    <BittenCard>
      <Text style={styles.title}>{recipe.title}</Text>
      <View style={styles.metaRow}>
        {recipe.cook_time_minutes ? (
          <Text style={styles.metaChip}>⏱ {formatTime(recipe.cook_time_minutes)}</Text>
        ) : null}
        {recipe.ai_generated ? (
          <Text style={styles.metaChip}>✨ AI-formatted{recipe.user_edited ? ' · edited' : ''}</Text>
        ) : null}
      </View>

      <Text style={styles.section}>Ingredients</Text>
      {recipe.ingredients.map((ing, i) => (
        <View key={i} style={styles.ingRow}>
          <Text style={styles.ingBullet}>•</Text>
          <Text style={styles.ingText}>
            {[ing.quantity, ing.unit].filter(Boolean).join(' ')}
            {ing.quantity || ing.unit ? ' ' : ''}
            {ing.item}
          </Text>
        </View>
      ))}

      <Text style={styles.section}>Steps</Text>
      {recipe.steps.map((s, i) => (
        <View key={i} style={styles.ingRow}>
          <Text style={styles.stepNum}>{i + 1}.</Text>
          <Text style={styles.ingText}>{s}</Text>
        </View>
      ))}
    </BittenCard>
  );
}

export function formatTime(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cocoa,
    paddingRight: 40, // clear the bitten corner
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  metaChip: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.amberDark,
    backgroundColor: colors.white,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
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
    marginBottom: 5,
  },
  ingBullet: {
    color: colors.amber,
    fontFamily: fonts.bold,
    marginRight: 8,
    fontSize: 15,
  },
  stepNum: {
    color: colors.amber,
    fontFamily: fonts.bold,
    marginRight: 8,
    fontSize: 14,
    minWidth: 18,
  },
  ingText: {
    fontFamily: fonts.semi,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.cocoa,
    flex: 1,
  },
});
