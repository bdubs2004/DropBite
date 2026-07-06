import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
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
import { defaultMealSlot } from '../lib/time';
import { getDataService } from '../services';
import { formatRecipe, FormattedRecipe } from '../services/ai';
import { searchPlaces } from '../services/places';
import { useApp } from '../state/AppContext';
import { colors, fonts, MEAL_SLOT_META, radius, spacing } from '../theme';
import { MealSlot, PlaceResult } from '../types';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Demo-friendly stand-in "photos" for testing on web where camera is awkward. */
const EMOJI_PHOTOS = ['🍳', '🥪', '🍲', '🍿', '🍝', '🥩', '🍣', '🥧'];

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

  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [searching, setSearching] = useState(false);

  const [posting, setPosting] = useState(false);

  const hasPhoto = Boolean(photoUri || photoEmoji);
  const canPost = hasPhoto && blurb.trim().length > 0 && !posting;

  const pickPhoto = async (fromCamera: boolean) => {
    try {
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: true,
        aspect: [4, 5],
      };
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.length) return;
      // compress client-side before upload; photos are the product,
      // so cap width generously (CLAUDE.md image handling rule)
      const manipulated = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );
      setPhotoUri(manipulated.uri);
      setPhotoEmoji(null);
    } catch {
      // camera unavailable (e.g. web) — no-op, user can pick from library/emoji
    }
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

  const slotMeta = MEAL_SLOT_META[slot];

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
          <Text style={styles.title}>Drop a bite</Text>
          <View style={{ width: 50 }} />
        </View>

        {/* 1 — photo (required) */}
        <Text style={styles.stepLabel}>📸 Photo — no photo, no post</Text>
        {photoUri ? (
          <View>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            <Pressable onPress={() => setPhotoUri(null)} style={styles.photoClear}>
              <Text style={styles.photoClearText}>✕</Text>
            </Pressable>
          </View>
        ) : photoEmoji ? (
          <View style={[styles.photoPreview, styles.emojiPreview]}>
            <Text style={{ fontSize: 84 }}>{photoEmoji}</Text>
            <Pressable onPress={() => setPhotoEmoji(null)} style={styles.photoClear}>
              <Text style={styles.photoClearText}>✕</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <View style={styles.photoButtons}>
              <Pressable style={styles.photoBtn} onPress={() => pickPhoto(true)}>
                <Text style={styles.photoBtnEmoji}>📷</Text>
                <Text style={styles.photoBtnText}>Camera</Text>
              </Pressable>
              <Pressable style={styles.photoBtn} onPress={() => pickPhoto(false)}>
                <Text style={styles.photoBtnEmoji}>🖼️</Text>
                <Text style={styles.photoBtnText}>Library</Text>
              </Pressable>
            </View>
            <Muted style={{ marginTop: spacing.sm }}>
              …or use a quick stand-in for testing:
            </Muted>
            <View style={styles.emojiRow}>
              {EMOJI_PHOTOS.map((e) => (
                <Pressable key={e} style={styles.emojiChip} onPress={() => setPhotoEmoji(e)}>
                  <Text style={{ fontSize: 26 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* 2 — meal slot */}
        <Text style={styles.stepLabel}>🍽️ Meal</Text>
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
                  {m.emoji} {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* 3 — blurb */}
        <Text style={styles.stepLabel}>✍️ What is it? (your words, always shown)</Text>
        <Input
          placeholder={'"chicken thing with garlic and whatever…"'}
          value={blurb}
          onChangeText={(t) => {
            setBlurb(t);
            setFormatFailed(null);
          }}
          multiline
        />

        {/* 4 — AI recipe card (optional, only on demand) */}
        {!recipe ? (
          <View>
            <Button
              title={formatting ? 'Formatting…' : '✨ Format as recipe card'}
              variant="secondary"
              onPress={runFormat}
              disabled={blurb.trim().length < 12}
              loading={formatting}
            />
            {formatFailed === 'not-recipe' ? (
              <Muted style={{ marginTop: spacing.sm }}>
                That doesn't look like a cooking description — no card needed. Your blurb is
                the post. 👍
              </Muted>
            ) : null}
            {formatFailed === 'error' ? (
              <Muted style={{ marginTop: spacing.sm }}>
                Couldn't format right now — your post works fine without it, or try again.
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

        {/* 5 — restaurant tag (optional) */}
        <Text style={styles.stepLabel}>📍 Ate out? Tag the spot (optional)</Text>
        {place ? (
          <View style={styles.placeSelected}>
            <View style={{ flex: 1 }}>
              <Text style={styles.placeName}>📍 {place.name}</Text>
              <Muted>{place.address}</Muted>
            </View>
            <Pressable onPress={() => setPlace(null)} hitSlop={8}>
              <Text style={styles.placeClearText}>✕</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <Input
              placeholder="Search restaurants…"
              value={placeQuery}
              onChangeText={runPlaceSearch}
            />
            {searching ? <Muted>Searching…</Muted> : null}
            {placeResults.map((p) => (
              <Pressable
                key={p.place_id}
                style={styles.placeRow}
                onPress={() => {
                  setPlace(p);
                  setPlaceResults([]);
                  setPlaceQuery('');
                }}
              >
                <Text style={styles.placeName}>{p.name}</Text>
                <Muted>{p.address}</Muted>
              </Pressable>
            ))}
          </View>
        )}

        <Button
          title={posting ? 'Dropping…' : 'Drop it 🍽️'}
          onPress={post}
          disabled={!canPost}
          loading={posting}
          style={{ marginTop: spacing.xl }}
        />
        {!hasPhoto ? (
          <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>
            Add a photo to post — DropBite is photo-first.
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
    fontSize: 22,
    color: colors.cocoa,
  },
  stepLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
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
    borderWidth: 2,
    borderColor: colors.creamDark,
    borderStyle: 'dashed',
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  photoBtnEmoji: {
    fontSize: 30,
    marginBottom: 4,
  },
  photoBtnText: {
    fontFamily: fonts.bold,
    color: colors.cocoaSoft,
    fontSize: 14,
  },
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
  },
  emojiChip: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.creamDark,
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
    backgroundColor: colors.amberSoft,
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
  photoClearText: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  slotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  slotChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 14,
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
  placeSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.amberSoft,
  },
  placeName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.cocoa,
  },
  placeClearText: {
    color: colors.cocoaSoft,
    fontFamily: fonts.bold,
    fontSize: 16,
    paddingHorizontal: 6,
  },
});
