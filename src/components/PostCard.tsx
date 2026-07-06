import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { relativeTime } from '../lib/time';
import { colors, fonts, MEAL_SLOT_META, radius, shadow, spacing } from '../theme';
import { Post } from '../types';
import { Avatar } from './Avatar';
import { PostPhoto } from './PostPhoto';
import { RecipeCardView } from './RecipeCardView';

export function PostCard({
  post,
  onToggleLike,
  onPressUser,
}: {
  post: Post;
  onToggleLike: (post: Post) => void;
  onPressUser?: (userId: string) => void;
}) {
  const [showRecipe, setShowRecipe] = useState(false);
  const slot = MEAL_SLOT_META[post.meal_slot];

  return (
    <View style={styles.card}>
      {/* header */}
      <View style={styles.header}>
        <Pressable style={styles.userRow} onPress={() => onPressUser?.(post.user_id)}>
          <Avatar user={post.user} size={40} />
          <View style={{ marginLeft: spacing.md, flex: 1 }}>
            <Text style={styles.name}>{post.user?.display_name ?? 'Someone'}</Text>
            <Text style={styles.meta}>
              @{post.user?.handle ?? 'unknown'} · {relativeTime(post.created_at)}
            </Text>
          </View>
        </Pressable>
        <View style={[styles.slotPill, { backgroundColor: slot.bg }]}>
          <Text style={[styles.slotText, { color: slot.color }]}>
            {slot.emoji} {slot.label}
          </Text>
        </View>
      </View>

      {/* photo */}
      <PostPhoto post={post} />

      {/* actions + blurb */}
      <View style={styles.body}>
        <View style={styles.actionsRow}>
          <Pressable onPress={() => onToggleLike(post)} style={styles.likeBtn} hitSlop={8}>
            <Text style={[styles.likeIcon, post.reacted_by_me && styles.liked]}>
              {post.reacted_by_me ? '❤️' : '🤍'}
            </Text>
            <Text style={styles.likeCount}>{post.reaction_count ?? 0}</Text>
          </Pressable>
          {post.restaurant_name ? (
            <View style={styles.placeTag}>
              <Text style={styles.placeText} numberOfLines={1}>
                📍 {post.restaurant_name}
              </Text>
            </View>
          ) : null}
        </View>

        {/* The user's own words, front and center — never replaced by AI */}
        <Text style={styles.blurb}>{post.blurb}</Text>

        {post.recipe ? (
          <Pressable onPress={() => setShowRecipe((v) => !v)} style={styles.recipeToggle}>
            <Text style={styles.recipeToggleText}>
              {showRecipe ? 'Hide recipe card ▲' : `📖 ${post.recipe.title} ▼`}
            </Text>
          </Pressable>
        ) : null}
        {showRecipe && post.recipe ? (
          <View style={{ marginTop: spacing.md }}>
            <RecipeCardView recipe={post.recipe} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    overflow: 'hidden',
    ...(shadow as object),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.cocoa,
  },
  meta: {
    fontFamily: fonts.semi,
    fontSize: 12,
    color: colors.cocoaFaint,
    marginTop: 1,
  },
  slotPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: spacing.sm,
  },
  slotText: {
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  body: {
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  likeIcon: {
    fontSize: 20,
  },
  liked: {
    transform: [{ scale: 1.05 }],
  },
  likeCount: {
    fontFamily: fonts.bold,
    color: colors.cocoaSoft,
    marginLeft: 6,
    fontSize: 14,
  },
  placeTag: {
    flex: 1,
    alignItems: 'flex-end',
  },
  placeText: {
    fontFamily: fonts.semi,
    fontSize: 12.5,
    color: colors.amberDark,
  },
  blurb: {
    fontFamily: fonts.semi,
    fontSize: 15.5,
    lineHeight: 22,
    color: colors.cocoa,
  },
  recipeToggle: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    backgroundColor: colors.cream,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.creamDark,
  },
  recipeToggleText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.amberDark,
  },
});
