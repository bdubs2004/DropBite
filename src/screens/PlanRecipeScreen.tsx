import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecipeCardEditor } from '../components/RecipeCardEditor';
import { RecipeCardView } from '../components/RecipeCardView';
import { Button } from '../components/ui';
import { tidyRecipe } from '../lib/myRecipe';
import { getDataService } from '../services';
import { FormattedRecipe } from '../services/ai';
import { useApp } from '../state/AppContext';
import { fonts, spacing, makeStyles, useColors } from '../theme';
import { MyRecipe, Recipe } from '../types';

/**
 * A recipe of your own (or a family member's) from the meal plan. Yours can
 * be edited or deleted here; deleting it leaves the meals it was on, just
 * without the card.
 */
export function PlanRecipeScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const { user } = useApp();
  const [recipe, setRecipe] = useState<MyRecipe>(route.params.recipe);
  const mine = recipe.user_id === user?.id;
  const [editing, setEditing] = useState<FormattedRecipe | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () =>
    setEditing({
      is_recipe: true,
      title: recipe.title,
      ingredients: recipe.ingredients.length ? recipe.ingredients : [{ item: '', quantity: '', unit: '' }],
      steps: recipe.steps.length ? recipe.steps : [''],
      cook_time_minutes: recipe.cook_time_minutes,
    });

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const next = await svc.saveMyRecipe({
        ...tidyRecipe(editing, recipe.title),
        id: recipe.id,
        ai_generated: recipe.ai_generated,
        // Changing an AI card by hand is what user_edited records.
        user_edited: recipe.ai_generated || recipe.user_edited,
      });
      setRecipe(next);
      setEditing(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save that recipe');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await svc.deleteMyRecipe(recipe.id);
      navigation.goBack();
    } catch (e: any) {
      setError(e?.message ?? 'Could not delete that recipe');
      setBusy(false);
    }
  };

  // RecipeCardView draws a post's card; a saved recipe is the same shape.
  const asCard: Recipe = { ...recipe, post_id: '' };

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
        <Text style={styles.title} numberOfLines={1}>
          Recipe
        </Text>
        <View style={[styles.side, { justifyContent: 'flex-end' }]}>
          {mine ? (
            editing ? (
              <Pressable testID="recipe-save" onPress={save} disabled={busy} hitSlop={10}>
                <Text style={styles.action}>{busy ? 'Saving' : 'Save'}</Text>
              </Pressable>
            ) : (
              <Pressable testID="recipe-edit" onPress={startEdit} hitSlop={10}>
                <Text style={styles.action}>Edit</Text>
              </Pressable>
            )
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <Text testID="recipe-error" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {editing ? (
          <View style={{ paddingHorizontal: spacing.xs }}>
            <RecipeCardEditor
              value={editing}
              onChange={setEditing}
              onRemove={() => setEditing(null)}
              label="Tap any field to edit"
              removeLabel="Cancel"
            />
          </View>
        ) : (
          <View testID="recipe-view">
            <RecipeCardView recipe={asCard} />
          </View>
        )}

        {mine && !editing ? (
          <View style={styles.footer}>
            {confirming ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={styles.confirmText}>
                  Delete this recipe? Meals already on the plan keep their names
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button testID="recipe-delete-confirm" variant="danger" title="Delete" onPress={remove} loading={busy} style={{ flex: 1 }} />
                  <Button variant="secondary" title="Cancel" onPress={() => setConfirming(false)} style={{ flex: 1 }} />
                </View>
              </View>
            ) : (
              <Pressable testID="recipe-delete" onPress={() => setConfirming(true)} style={{ paddingVertical: spacing.sm }}>
                <Text style={styles.danger}>Delete recipe</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </ScrollView>
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
  action: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  error: { fontFamily: fonts.semi, fontSize: 13, color: colors.danger, marginBottom: spacing.sm },
  footer: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.xs,
  },
  danger: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.danger },
  confirmText: { fontFamily: fonts.semi, fontSize: 14, lineHeight: 20, color: colors.cocoa },
}));
