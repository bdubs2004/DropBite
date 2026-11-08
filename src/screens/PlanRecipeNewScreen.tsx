import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BuiltCard, RecipeBuilder, saveBuiltCard } from '../components/RecipeBuilder';
import { Button } from '../components/ui';
import { getDataService } from '../services';
import { fonts, spacing, makeStyles, useColors } from '../theme';

/**
 * A meal that went on the plan as just a name ("Pizza night") gets a recipe
 * card, or just the ingredients it needs so they land on the grocery list.
 * Saved to your recipes too, to plan again.
 */
export function PlanRecipeNewScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const { itemId, mealTitle } = route.params as { itemId: string; mealTitle: string };
  const [built, setBuilt] = useState<BuiltCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!built || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveBuiltCard(svc, built, mealTitle);
      await svc.setPlanItemRecipe(itemId, saved.id);
      navigation.goBack();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save that');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <Pressable testID="recipe-new-cancel" onPress={() => navigation.goBack()} hitSlop={10} style={styles.side}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {mealTitle}
        </Text>
        <View style={styles.side} />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {!built ? (
          <View style={styles.lead}>
            <Ionicons name="cart-outline" size={18} color={colors.cocoaSoft} />
            <Text style={styles.leadText}>What it needs goes on your grocery list</Text>
          </View>
        ) : null}
        <RecipeBuilder name={mealTitle} value={built} onChange={setBuilt} onError={setError} />
        {error ? (
          <Text testID="recipe-new-error" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {built ? (
          <Button testID="recipe-new-save" title="Save" onPress={save} loading={busy} style={{ marginTop: spacing.sm }} />
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
  side: { width: 60 },
  cancel: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  lead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  leadText: { fontFamily: fonts.semi, fontSize: 14, color: colors.cocoaSoft },
  error: { fontFamily: fonts.semi, fontSize: 13, color: colors.danger },
}));
