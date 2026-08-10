import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
  onDelete,
  onReport,
  isMine,
}: {
  post: Post;
  onToggleLike: (post: Post) => void;
  onComment?: (post: Post) => void;
  onShare?: (post: Post) => void;
  onRepost?: (post: Post) => void;
  onToggleSave?: (post: Post) => void;
  onPressUser?: (userId: string) => void;
  /** Omit to hide the delete affordance entirely. */
  onDelete?: (post: Post) => void;
  /** Omit to hide the report affordance entirely. */
  onReport?: (post: Post) => void;
  /** True when the signed-in user wrote this post. */
  isMine?: boolean;
}) {
  const [showRecipe, setShowRecipe] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const slot = MEAL_SLOT_META[post.meal_slot];

  // One menu, two outcomes: your own post can be deleted, anyone else's can be
  // reported. Reporting your own post is meaningless (just delete it), so the
  // two never appear together.
  const canDelete = Boolean(isMine && onDelete);
  const canReport = Boolean(!isMine && onReport);
  const hasMenu = canDelete || canReport;

  const openMenu = () => {
    if (canReport) {
      onReport?.(post);
      return;
    }
    askDelete();
  };

  const askDelete = () => {
    // Alert.alert is a no-op on react-native-web, so web gets an inline
    // confirmation bar instead (same pattern as Settings > Delete account).
    if (Platform.OS === 'web') {
      setConfirmingDelete(true);
      return;
    }
    Alert.alert(
      'Delete post?',
      'This removes the photo, recipe card, likes, and comments. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: runDelete },
      ],
    );
  };

  const runDelete = async () => {
    setDeleting(true);
    try {
      await onDelete?.(post);
      // No need to reset state: the screen refreshes and this card unmounts.
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

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
        {hasMenu ? (
          <Pressable
            testID={canDelete ? 'post-menu-delete' : 'post-menu-report'}
            onPress={openMenu}
            hitSlop={10}
            style={styles.menuBtn}
            accessibilityLabel={canDelete ? 'Delete post' : 'Report post'}
          >
            <Ionicons name="ellipsis-horizontal" size={19} color={colors.cocoaFaint} />
          </Pressable>
        ) : null}
      </View>

      {/* inline delete confirmation (web) */}
      {confirmingDelete ? (
        <View style={styles.confirmBar}>
          <Text style={styles.confirmText}>
            Delete this post? The photo, recipe, likes, and comments go with it.
          </Text>
          <View style={styles.confirmActions}>
            <Pressable
              testID="post-delete-cancel"
              onPress={() => setConfirmingDelete(false)}
              disabled={deleting}
              style={[styles.confirmBtn, styles.confirmCancel]}
            >
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="post-delete-confirm"
              onPress={runDelete}
              disabled={deleting}
              style={[styles.confirmBtn, styles.confirmDelete, deleting && { opacity: 0.6 }]}
            >
              <Text style={styles.confirmDeleteText}>{deleting ? 'Deleting' : 'Delete'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

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

        {/* The user's own words, front and center. Never replaced by AI.
            The handle runs inline in bold ahead of the caption, Instagram
            style — one Text so it wraps as a single paragraph. */}
        <Text style={styles.blurb}>
          {post.user?.handle ? (
            <Text
              style={styles.blurbHandle}
              onPress={() => onPressUser?.(post.user_id)}
              suppressHighlighting
            >
              {post.user.handle}{' '}
            </Text>
          ) : null}
          {post.blurb}
        </Text>

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
  menuBtn: {
    paddingLeft: spacing.sm,
    paddingVertical: 4,
  },
  confirmBar: {
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.creamDark,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  confirmText: {
    fontFamily: fonts.semi,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.cocoa,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  confirmBtn: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  confirmCancel: {
    backgroundColor: colors.creamDark,
  },
  confirmCancelText: {
    fontFamily: fonts.bold,
    fontSize: 13.5,
    color: colors.cocoa,
  },
  confirmDelete: {
    backgroundColor: colors.danger,
  },
  confirmDeleteText: {
    fontFamily: fonts.bold,
    fontSize: 13.5,
    color: colors.white,
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
  blurbHandle: {
    fontFamily: fonts.bold,
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
