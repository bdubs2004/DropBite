import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LOCATION_TAGGING_ENABLED } from '../config';
import { relativeTime } from '../lib/time';
import { colors, fonts, MEAL_SLOT_META, radius, shadow, spacing } from '../theme';
import { Post } from '../types';
import { Avatar } from './Avatar';
import { PostPhoto } from './PostPhoto';
import { RecipeCardView } from './RecipeCardView';

export function PostCard({
  post,
  onToggleLike,
  onComment,
  onShare,
  onRepost,
  onToggleSave,
  onPressUser,
}: {
  post: Post;
  onToggleLike: (post: Post) => void;
  onComment?: (post: Post) => void;
  onShare?: (post: Post) => void;
  onRepost?: (post: Post) => void;
  onToggleSave?: (post: Post) => void;
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
          <Text style={[styles.slotText, { color: slot.color }]}>{slot.label}</Text>
        </View>
      </View>

      {/* photo */}
      <PostPhoto post={post} />

      {/* actions + blurb */}
      <View style={styles.body}>
        <View style={styles.actionsRow}>
          <Pressable
            testID="post-like"
            onPress={() => onToggleLike(post)}
            style={styles.actionBtn}
            hitSlop={8}
          >
            <Ionicons
              name={post.reacted_by_me ? 'heart' : 'heart-outline'}
              size={23}
              color={post.reacted_by_me ? colors.danger : colors.cocoaSoft}
            />
            <Text style={styles.actionCount}>{post.reaction_count ?? 0}</Text>
          </Pressable>
          <Pressable
            testID="post-comment"
            onPress={() => onComment?.(post)}
            style={styles.actionBtn}
            hitSlop={8}
          >
            <Ionicons name="chatbubble-outline" size={21} color={colors.cocoaSoft} />
            <Text style={styles.actionCount}>{post.comment_count ?? 0}</Text>
          </Pressable>
          <Pressable
            testID="post-share"
            onPress={() => onShare?.(post)}
            style={styles.actionBtn}
            hitSlop={8}
          >
            <Ionicons name="paper-plane-outline" size={21} color={colors.cocoaSoft} />
            <Text style={styles.actionCount}>{post.share_count ?? 0}</Text>
          </Pressable>
          <Pressable
            testID="post-repost"
            onPress={() => onRepost?.(post)}
            style={styles.actionBtn}
            hitSlop={8}
          >
            <Ionicons
              name={post.reposted_by_me ? 'repeat' : 'repeat-outline'}
              size={23}
              color={post.reposted_by_me ? colors.success : colors.cocoaSoft}
            />
            <Text
              style={[styles.actionCount, post.reposted_by_me && { color: colors.success }]}
            >
              {post.repost_count ?? 0}
            </Text>
          </Pressable>
          <Pressable
            testID="post-save"
            onPress={() => onToggleSave?.(post)}
            style={styles.bookmarkBtn}
            hitSlop={8}
          >
            <Ionicons
              name={post.saved_by_me ? 'bookmark' : 'bookmark-outline'}
              size={21}
              color={post.saved_by_me ? colors.amberDark : colors.cocoaSoft}
            />
          </Pressable>
        </View>

        {/* Restaurant "where you ate" tag — deferred to Phase 2, gated on
            LOCATION_TAGGING_ENABLED (src/config.ts). Existing posts keep their
            restaurant_name in the data; it just isn't shown while off. */}
        {LOCATION_TAGGING_ENABLED && post.restaurant_name ? (
          <View style={styles.placeTag}>
            <Ionicons name="location-sharp" size={13} color={colors.amberDark} />
            <Text style={styles.placeText} numberOfLines={1}>
              {post.restaurant_name}
            </Text>
          </View>
        ) : null}

        {/* The user's own words, front and center. Never replaced by AI. */}
        <Text style={styles.blurb}>{post.blurb}</Text>

        {post.recipe ? (
          <Pressable onPress={() => setShowRecipe((v) => !v)} style={styles.recipeToggle}>
            <Ionicons name="book-outline" size={14} color={colors.amberDark} />
            <Text style={styles.recipeToggleText}>{post.recipe.title}</Text>
            <Ionicons
              name={showRecipe ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.amberDark}
            />
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
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginLeft: spacing.sm,
  },
  slotText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  body: {
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.xl,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    fontFamily: fonts.bold,
    color: colors.cocoaSoft,
    fontSize: 14,
  },
  bookmarkBtn: {
    flex: 1,
    alignItems: 'flex-end',
  },
  placeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginBottom: spacing.xs,
  },
  placeText: {
    fontFamily: fonts.semi,
    fontSize: 12.5,
    color: colors.amberDark,
    flexShrink: 1,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
