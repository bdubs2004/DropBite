import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecipeCardEditor } from '../components/RecipeCardEditor';
import { Button, Input, Muted } from '../components/ui';
import { LIMITS } from '../lib/limits';
import { pickImage } from '../lib/pickImage';
import { defaultMealSlot } from '../lib/time';
import { getDataService } from '../services';
import { formatRecipe, FormattedRecipe } from '../services/ai';
import { searchPlaces } from '../services/places';
import { LOCATION_TAGGING_ENABLED } from '../config';
import { useApp } from '../state/AppContext';
import { colors, fonts, MEAL_SLOT_META, radius, spacing } from '../theme';
import { MealSlot, PlaceResult } from '../types';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function ComposeScreen({ navigation }: any) {
  const { refreshFeed } = useApp();
  const insets = useSafeAreaInsets();
  const svc = getDataService();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoEmoji, setPhotoEmoji] = useState<string | null>(null);
  const [slot, setSlot] = useState<MealSlot>(defaultMealSlot());
  const [blurb, setBlurb] = useState('');
  const [recipe, setRecipe] = useState<FormattedRecipe | null>(null);
  const [recipeEdited, setRecipeEdited] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [formatFailed, setFormatFailed] = useState<null | 'not-recipe' | 'error'>(null);

  const [tagsOpen, setTagsOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [searching, setSearching] = useState(false);

  const [posting, setPosting] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const hasPhoto = Boolean(photoUri || photoEmoji);
  const canPost = hasPhoto && blurb.trim().length > 0 && !posting;

  const pickPhoto = async (fromCamera: boolean) => {
    setPhotoError(null);
    const res = await pickImage({ fromCamera, aspect: [4, 5], width: 1600 });
    if (res.error) {
      setPhotoError(res.error);
      return;
    }
    if (!res.uri) return; // cancelled
    setPhotoUri(res.uri);
    setPhotoEmoji(null);
  };

  const runFormat = async () => {
    setFormatting(true);
    setFormatFailed(null);
    const result = await formatRecipe(blurb);
    setFormatting(false);
    if (!result) {
      setFormatFailed('error');
      return;
    }
    if (!result.is_recipe) {
      setFormatFailed('not-recipe');
      return;
    }
    setRecipe(result);
    setRecipeEdited(false);
  };

  const runPlaceSearch = async (q: string) => {
    setPlaceQuery(q);
    if (q.trim().length < 2) {
      setPlaceResults([]);
      return;
    }
    setSearching(true);
    const results = await searchPlaces(q);
    setSearching(false);
    setPlaceResults(results);
  };

  const post = async () => {
    setPosting(true);
    try {
      await svc.createPost({
        meal_slot: slot,
        photo_url: photoUri,
        photo_emoji: photoEmoji,
        blurb: blurb.trim(),
        restaurant: place,
        recipe: recipe
          ? {
              title: recipe.title.trim() || 'My Recipe',
              ingredients: recipe.ingredients.filter((i) => i.item.trim()),
              steps: recipe.steps.filter((s) => s.trim()),
              cook_time_minutes: recipe.cook_time_minutes,
              ai_generated: true,
              user_edited: recipeEdited,
            }
          : null,
      });
      await refreshFeed();
      navigation.goBack();
    } finally {
      setPosting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>New post</Text>
          <View style={{ width: 50 }} />
        </View>

        {/* 1: photo (required) */}
        <Text style={styles.stepLabel}>Photo</Text>
        {photoUri ? (
          <View>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            <Pressable onPress={() => setPhotoUri(null)} style={styles.photoClear}>
              <Ionicons name="close" size={18} color={colors.white} />
            </Pressable>
          </View>
        ) : photoEmoji ? (
          <View style={[styles.photoPreview, styles.emojiPreview]}>
            <Text style={{ fontSize: 76 }}>{photoEmoji}</Text>
            <Pressable onPress={() => setPhotoEmoji(null)} style={styles.photoClear}>
              <Ionicons name="close" size={18} color={colors.white} />
            </Pressable>
          </View>
        ) : (
          <View>
            <View style={styles.photoButtons}>
              <Pressable
                testID="photo-camera"
                style={styles.photoBtn}
                onPress={() => pickPhoto(true)}
              >
                <Ionicons name="camera" size={28} color={colors.amber} />
                <Text style={styles.photoBtnText}>Camera</Text>
              </Pressable>
              <Pressable
                testID="photo-library"
                style={styles.photoBtn}
                onPress={() => pickPhoto(false)}
              >
                <Ionicons name="image" size={28} color={colors.amber} />
                <Text style={styles.photoBtnText}>Library</Text>
              </Pressable>
            </View>
            {photoError ? (
              <Text testID="photo-error" style={styles.photoErrorText}>
                {photoError}
              </Text>
            ) : null}
          </View>
        )}

        {/* 2: tags (restaurant "where you ate") — deferred to Phase 2.
            Gated on LOCATION_TAGGING_ENABLED (src/config.ts). Flip that flag
            to bring the whole tagging UI back; nothing else needs to change. */}
        {LOCATION_TAGGING_ENABLED ? (
          <>
            <Text style={styles.stepLabel}>Tags</Text>
            {place ? (
              <View style={styles.tagRow}>
                <Ionicons name="location-sharp" size={20} color={colors.amber} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.tagText}>{place.name}</Text>
                  <Muted>{place.address}</Muted>
                </View>
                <Pressable onPress={() => setPlace(null)} hitSlop={8}>
                  <Ionicons name="close" size={18} color={colors.cocoaSoft} />
                </Pressable>
              </View>
            ) : (
              <View>
                <Pressable style={styles.tagRow} onPress={() => setTagsOpen((v) => !v)}>
                  <Ionicons name="pricetag" size={20} color={colors.amber} />
                  <Text style={[styles.tagText, { flex: 1, marginLeft: spacing.md }]}>Tag</Text>
                  <Ionicons
                    name={tagsOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.amberDark}
                  />
                </Pressable>
                {tagsOpen ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Input
                      placeholder="Search restaurants"
                      value={placeQuery}
                      onChangeText={runPlaceSearch}
                    />
                    {searching ? <Muted>Searching</Muted> : null}
                    {placeResults.map((p) => (
                      <Pressable
                        key={p.place_id}
                        style={styles.placeRow}
                        onPress={() => {
                          setPlace(p);
                          setPlaceResults([]);
                          setPlaceQuery('');
                          setTagsOpen(false);
                        }}
                      >
                        <Text style={styles.placeName}>{p.name}</Text>
                        <Muted>{p.address}</Muted>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            )}
          </>
        ) : null}

        {/* 3: meal slot */}
        <Text style={styles.stepLabel}>Meal</Text>
        <View style={styles.slotRow}>
          {SLOTS.map((s) => {
            const m = MEAL_SLOT_META[s];
            const active = s === slot;
            return (
              <Pressable
                key={s}
                onPress={() => setSlot(s)}
                style={[
                  styles.slotChip,
                  { backgroundColor: active ? m.bg : colors.white },
                  active && { borderColor: m.color },
                ]}
              >
                <Text style={[styles.slotChipText, { color: active ? m.color : colors.cocoaFaint }]}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* 4: blurb */}
        <Text style={styles.stepLabel}>Description</Text>
        <Muted style={{ marginBottom: spacing.sm }}>
          Your own words, shown on the post exactly as written.
        </Muted>
        <Input
          placeholder="Seared chicken thighs with garlic and a splash of cream..."
          value={blurb}
          onChangeText={(t) => {
            setBlurb(t);
            setFormatFailed(null);
          }}
          multiline
          maxLength={LIMITS.blurb}
        />

        {/* 5: AI recipe card (optional, only on demand) */}
        {!recipe ? (
          <View>
            <Button
              title={formatting ? 'Formatting' : 'Format as recipe card'}
              variant="secondary"
              onPress={runFormat}
              disabled={blurb.trim().length < 12}
              loading={formatting}
            />
            {formatFailed === 'not-recipe' ? (
              <Muted style={{ marginTop: spacing.sm }}>
                That reads like a meal out rather than a cooking description, so no recipe
                card is needed. Your description is the post.
              </Muted>
            ) : null}
            {formatFailed === 'error' ? (
              <Muted style={{ marginTop: spacing.sm }}>
                Formatting is unavailable right now. Your post works fine without it, or
                try again in a moment.
              </Muted>
            ) : null}
          </View>
        ) : (
          <RecipeCardEditor
            value={recipe}
            onChange={(r) => {
              setRecipe(r);
              setRecipeEdited(true);
            }}
            onRemove={() => setRecipe(null)}
          />
        )}

        <Button
          title={posting ? 'Sharing' : 'Share post'}
          onPress={post}
          disabled={!canPost}
          loading={posting}
          style={{ marginTop: spacing.xl }}
        />
        {!hasPhoto ? (
          <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>
            Add a photo to post. nibl is photo-first.
          </Muted>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  cancel: {
    fontFamily: fonts.bold,
    color: colors.cocoaSoft,
    fontSize: 15,
    width: 50,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.cocoa,
  },
  stepLabel: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  photoButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  photoBtn: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
    borderStyle: 'dashed',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: 6,
  },
  photoBtnText: {
    fontFamily: fonts.bold,
    color: colors.cocoaSoft,
    fontSize: 14,
  },
  photoErrorText: {
    fontFamily: fonts.semi,
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 15,
  },
  tagText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.cocoa,
  },
  photoPreview: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: radius.lg,
    backgroundColor: colors.creamDark,
  },
  emojiPreview: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B08D5E',
  },
  photoClear: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: colors.overlay,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  slotChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
  },
  slotChipText: {
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  placeRow: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  placeName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.cocoa,
  },
});
