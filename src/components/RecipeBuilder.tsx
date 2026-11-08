import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { tidyRecipe } from '../lib/myRecipe';
import { DataService } from '../services/types';
import { FormattedRecipe, formatRecipe, titleFromBlurb } from '../services/ai';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { MyRecipe } from '../types';
import { RecipeCardEditor } from './RecipeCardEditor';
import { Button } from './ui';

/** A card being made, and how: by hand, by the AI, or just a list of ingredients. */
export interface BuiltCard {
  card: FormattedRecipe;
  ai: boolean;
  /** The AI's card as it came back, to tell whether it was edited. */
  aiOriginal: string;
  ingredientsOnly: boolean;
}

/** Save what was built to your recipes. The meal's name wins as the title. */
export async function saveBuiltCard(svc: DataService, built: BuiltCard, mealName: string): Promise<MyRecipe> {
  const tidy = tidyRecipe(built.card, mealName);
  return svc.saveMyRecipe({
    ...tidy,
    steps: built.ingredientsOnly ? [] : tidy.steps,
    cook_time_minutes: built.ingredientsOnly ? null : tidy.cook_time_minutes,
    ai_generated: built.ai,
    user_edited: built.ai && JSON.stringify(built.card) !== built.aiOriginal,
  });
}

const blank = (title: string, ingredientsOnly: boolean): FormattedRecipe => ({
  is_recipe: true,
  title,
  ingredients: [
    { item: '', quantity: '', unit: '' },
    ...(ingredientsOnly ? [{ item: '', quantity: '', unit: '' }, { item: '', quantity: '', unit: '' }] : []),
  ],
  steps: ingredientsOnly ? [] : [''],
  cook_time_minutes: null,
});

/**
 * Give a meal a recipe card three ways: write the recipe, list just the
 * ingredients (all the grocery list needs), or describe it however you like
 * and let the AI format it. Whatever comes out is an editable card, so you
 * can dial it in before it's saved.
 */
export function RecipeBuilder({
  name,
  value,
  onChange,
  onError,
}: {
  /** The meal's name: the card's title, and what the AI starts from. */
  name: string;
  value: BuiltCard | null;
  onChange: (next: BuiltCard | null) => void;
  onError: (message: string | null) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [describing, setDescribing] = useState(false);
  const [description, setDescription] = useState('');
  const [formatting, setFormatting] = useState(false);

  const start = (ingredientsOnly: boolean) => {
    setDescribing(false);
    onError(null);
    onChange({ card: blank(name.trim(), ingredientsOnly), ai: false, aiOriginal: '', ingredientsOnly });
  };

  const runAi = async () => {
    const text = description.trim();
    if (!text || formatting) return;
    setFormatting(true);
    onError(null);
    const result = await formatRecipe(text);
    setFormatting(false);
    if (!result || result === 'limited') {
      onError(
        result === 'limited'
          ? "You've used the recipe formatter a lot today. Try again later, or write it yourself"
          : "Couldn't format that one. Try again, or write it yourself",
      );
      return;
    }
    // Tapping Format always gives a card: if there was nothing to work from,
    // a blank one named from your words.
    const formatted = result.is_recipe
      ? result
      : { ...result, is_recipe: true, title: titleFromBlurb(text), ingredients: [], steps: [] };
    // The name you gave the meal wins over whatever the AI calls it.
    const card = name.trim() ? { ...formatted, title: name.trim() } : formatted;
    onChange({ card, ai: true, aiOriginal: JSON.stringify(card), ingredientsOnly: false });
    setDescribing(false);
  };

  if (value) {
    return (
      <RecipeCardEditor
        value={value.card}
        onChange={(card) => onChange({ ...value, card })}
        onRemove={() => onChange(null)}
        hideSteps={value.ingredientsOnly}
        label={
          value.ai
            ? 'AI-formatted recipe. Tap any field to edit.'
            : value.ingredientsOnly
              ? 'What it needs. Tap any field to edit.'
              : 'Your recipe. Tap any field to edit.'
        }
      />
    );
  }

  if (describing) {
    return (
      <View style={{ gap: spacing.sm }}>
        <TextInput
          testID="builder-describe"
          keyboardAppearance={colors.dark ? 'dark' : 'light'}
          value={description}
          onChangeText={setDescription}
          placeholder="Describe it however you like: what goes in, how you make it"
          placeholderTextColor={colors.cocoaFaint}
          style={styles.describe}
          multiline
          scrollEnabled={false}
          maxLength={2000}
          autoFocus
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            testID="builder-format"
            title={formatting ? 'Formatting' : 'Format recipe'}
            onPress={runAi}
            loading={formatting}
            disabled={!description.trim()}
            small
            style={{ flex: 1 }}
          />
          <Button title="Cancel" variant="secondary" small onPress={() => setDescribing(false)} style={{ flex: 1 }} />
        </View>
      </View>
    );
  }

  const options = [
    { key: 'write', icon: 'create-outline', label: 'Write the recipe', onPress: () => start(false) },
    { key: 'ingredients', icon: 'list-outline', label: 'Just the ingredients', onPress: () => start(true) },
    {
      key: 'ai',
      icon: 'sparkles-outline',
      label: 'Format with AI',
      onPress: () => {
        setDescription((d) => d || name);
        setDescribing(true);
      },
    },
  ];
  return (
    <View style={styles.options}>
      {options.map((o, i) => (
        <Pressable
          key={o.key}
          testID={`builder-${o.key}`}
          onPress={o.onPress}
          style={({ pressed }) => [styles.option, i > 0 && styles.optionRule, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name={o.icon as any} size={20} color={colors.cocoa} />
          <Text style={styles.optionText}>{o.label}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.cocoaFaint} />
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  options: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13 },
  optionRule: { borderTopWidth: 1, borderColor: colors.hairline },
  optionText: { flex: 1, fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  describe: {
    minHeight: 110,
    textAlignVertical: 'top',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fonts.semi,
    fontSize: 15.5,
    color: colors.cocoa,
  },
}));
