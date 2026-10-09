import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LOCATION_TAGGING_ENABLED } from '../config';
import { relativeTime } from '../lib/time';
import { useApp } from '../state/AppContext';
import { colors, fonts, MEAL_SLOT_META, radius, shadow, spacing } from '../theme';
import { Post } from '../types';
import { ActionSheet } from './ActionSheet';
import { Avatar } from './Avatar';
import { HeartBurst, HeartBurstHandle } from './HeartBurst';
import { PinchZoom } from './PinchZoom';
import { PostPhoto } from './PostPhoto';
import { RecipeCardView } from './RecipeCardView';
import { RepostBubble } from './RepostBubble';
import { TagDot } from './TagDot';

function PostCardView({
  post,
  onToggleLike,
  onShowLikes,
  onComment,
  onShare,
  onRepost,
  onToggleSave,
  onPressUser,
  onDelete,
  onReport,
  onAddToCollection,
  onTagPeople,
  onUntagMe,
  isMine,
}: {
  post: Post;
  onToggleLike: (post: Post) => void;
  /** Your own post: the heart opens who liked it (you can't like your own). */
  onShowLikes?: (post: Post) => void;
  onComment?: (post: Post) => void;
  onShare?: (post: Post) => void;
  onRepost?: (post: Post) => void;
  onToggleSave?: (post: Post) => void;
  onPressUser?: (userId: string) => void;
  /** Omit to hide the delete affordance entirely. */
  onDelete?: (post: Post) => void;
  /** Omit to hide the report affordance entirely. */
  onReport?: (post: Post) => void;
  /** Your own posts: put it in one of your collections. Omit to hide it. */
  onAddToCollection?: (post: Post) => void;
  /** Your own posts: change who's tagged. Omit to hide it. */
  onTagPeople?: (post: Post) => void;
  /** Posts you're tagged in: take yourself off. Omit to hide it. */
  onUntagMe?: (post: Post) => void;
  /** True when the signed-in user wrote this post. */
  isMine?: boolean;
}) {
  const [showRecipe, setShowRecipe] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const slot = MEAL_SLOT_META[post.meal_slot];

  // Optimistic like/repost/save so the button responds instantly and the
  // screen doesn't have to re-pull the whole list on every tap (that full
  // refresh was the jarring "it reloads every time" on the feed, and the
  // reason a like from the profile/detail looked stale until the next tap).
  // We still persist via the parent handler; these sync back if a real
  // refresh brings new values.
  const [liked, setLiked] = useState(!!post.reacted_by_me);
  const [likeCount, setLikeCount] = useState(post.reaction_count ?? 0);
  const [reposted, setReposted] = useState(!!post.reposted_by_me);
  const [repostCount, setRepostCount] = useState(post.repost_count ?? 0);
  const [saved, setSaved] = useState(!!post.saved_by_me);
  // Photo size, so the draggable repost bubble can be clamped to the image.
  const [photoSize, setPhotoSize] = useState({ w: 0, h: 0 });
  const reposters = post.reposters ?? (post.reposter ? [post.reposter] : []);
  // Who's tagged, held locally so "Remove me" takes effect at once.
  const { user: me } = useApp();
  const [tagged, setTagged] = useState(post.tagged ?? []);
  useEffect(() => setTagged(post.tagged ?? []), [post.tagged]);
  const iAmTagged = !isMine && !!me && tagged.some((u) => u.id === me.id);
  useEffect(() => {
    setLiked(!!post.reacted_by_me);
    setLikeCount(post.reaction_count ?? 0);
    setReposted(!!post.reposted_by_me);
    setRepostCount(post.repost_count ?? 0);
    setSaved(!!post.saved_by_me);
  }, [
    post.id,
    post.reacted_by_me,
    post.reaction_count,
    post.reposted_by_me,
    post.repost_count,
    post.saved_by_me,
  ]);

  const handleLike = () => {
    // Your own post can't be liked: the heart shows who liked it instead.
    if (isMine) {
      onShowLikes?.(post);
      return;
    }
    setLikeCount((c) => c + (liked ? -1 : 1));
    setLiked((v) => !v);
    onToggleLike(post);
  };
  // Double-tap the photo to like it, Instagram style: it only ever likes
  // (never unlikes), and the heart pops either way so it feels answered.
  const burstRef = useRef<HeartBurstHandle>(null);
  const doubleTapLike = () => {
    if (isMine) return; // nothing to like on your own post
    burstRef.current?.pop();
    if (!liked) handleLike();
  };
  const handleRepost = () => {
    setRepostCount((c) => c + (reposted ? -1 : 1));
    setReposted((v) => !v);
    onRepost?.(post);
  };
  const handleSave = () => {
    setSaved((v) => !v);
    onToggleSave?.(post);
  };

  // One menu, two outcomes: your own post can be deleted, anyone else's can be
  // reported. Reporting your own post is meaningless (just delete it), so the
  // two never appear together.
  const canDelete = Boolean(isMine && onDelete);
  const canReport = Boolean(!isMine && onReport);


  const askDelete = () => {
    setConfirmingDelete(true);
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

  /**
   * One menu for both entry points: the ··· button and a long-press anywhere
   * on the card. Your own post offers Share + Delete, anyone else's offers
   * Share + Report.
   */
  const menuActions = [
    ...(onShare
      ? [
          {
            key: 'share',
            label: 'Share',
            hint: 'Send inside NiblGo or copy a link',
            icon: 'paper-plane-outline' as const,
            onPress: () => onShare(post),
          },
        ]
      : []),
    ...(isMine && onAddToCollection
      ? [
          {
            key: 'collection',
            label: 'Add to collection',
            hint: 'Put it in one of your collections, or start a new one',
            icon: 'albums-outline' as const,
            onPress: () => onAddToCollection(post),
          },
        ]
      : []),
    ...(isMine && onTagPeople
      ? [
          {
            key: 'tag-people',
            label: 'Tag people',
            hint: post.tagged?.length ? 'Change who is tagged' : 'Tag who you ate with',
            icon: 'pricetag-outline' as const,
            onPress: () => onTagPeople(post),
          },
        ]
      : []),
    ...(iAmTagged && onUntagMe
      ? [
          {
            key: 'untag-me',
            label: 'Remove me from this post',
            hint: 'Takes your tag off. The post stays up',
            icon: 'pricetag-outline' as const,
            onPress: () => {
              setTagged((prev) => prev.filter((u) => u.id !== me?.id));
              onUntagMe(post);
            },
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            key: 'delete',
            label: 'Delete post',
            hint: 'Removes the photo, recipe, likes and comments',
            icon: 'trash-outline' as const,
            destructive: true,
            onPress: askDelete,
          },
        ]
      : []),
    ...(canReport
      ? [
          {
            key: 'report',
            label: 'Report post',
            hint: 'Send it to us for review, confidentially',
            icon: 'flag-outline' as const,
            destructive: true,
            onPress: () => onReport?.(post),
          },
        ]
      : []),
  ];

  const openMenu = () => setMenuOpen(true);

  return (
    <Pressable
      testID={`post-card-${post.id}`}
      style={styles.card}
      onLongPress={() => menuActions.length > 0 && setMenuOpen(true)}
      delayLongPress={350}
    >
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
        {menuActions.length > 0 ? (
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

      {/* inline delete confirmation (an in-app bar, not a system alert, so
          nothing dims the screen) */}
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

      {/* photo, with a draggable "reposted" bubble over it when this post is in
          the feed because people you follow reposted it */}
      <View
        style={styles.photoWrap}
        onLayout={(e) =>
          setPhotoSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
      >
        {/* pinch with two fingers to zoom; springs back on release */}
        <PinchZoom
          onLongPress={menuActions.length > 0 ? openMenu : undefined}
          onDoubleTap={doubleTapLike}
        >
          <PostPhoto post={post} />
        </PinchZoom>
        <HeartBurst ref={burstRef} />
        {reposters.length > 0 && photoSize.w > 0 ? (
          <RepostBubble
            reposters={reposters}
            containerW={photoSize.w}
            containerH={photoSize.h}
            onPressUser={onPressUser}
            // The tag dot owns the corner, so the bubble starts above it.
            lift={tagged.length ? 40 : 0}
          />
        ) : null}
        {/* Who's tagged: a dot in the corner that rolls out their names. */}
        {tagged.length && photoSize.w > 0 ? (
          <TagDot
            key={tagged.map((u) => u.id).join(',')}
            tagged={tagged}
            maxWidth={photoSize.w - 20}
            onPressUser={onPressUser}
          />
        ) : null}
      </View>

      {/* actions + blurb */}
      <View style={styles.body}>
        <View style={styles.actionsRow}>
          <Pressable
            testID="post-like"
            onPress={handleLike}
            style={styles.actionBtn}
            hitSlop={8}
            accessibilityLabel={isMine ? 'See who liked this' : liked ? 'Unlike' : 'Like'}
          >
            <Ionicons
              name={liked ? 'heart' : 'heart-outline'}
              size={23}
              color={liked ? colors.danger : colors.cocoaSoft}
            />
            <Text style={styles.actionCount}>{likeCount}</Text>
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
            onPress={handleRepost}
            style={styles.actionBtn}
            hitSlop={8}
          >
            <Ionicons
              name={reposted ? 'repeat' : 'repeat-outline'}
              size={23}
              color={reposted ? colors.success : colors.cocoaSoft}
            />
            <Text style={[styles.actionCount, reposted && { color: colors.success }]}>
              {repostCount}
            </Text>
          </Pressable>
          <Pressable
            testID="post-save"
            onPress={handleSave}
            style={styles.bookmarkBtn}
            hitSlop={8}
          >
            <Ionicons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={21}
              color={saved ? colors.amberDark : colors.cocoaSoft}
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
          <Pressable
            testID="post-recipe-toggle"
            onPress={() => setShowRecipe((v) => !v)}
            style={styles.recipeToggle}
            accessibilityLabel={`Recipe: ${post.recipe.title}`}
          >
            <Ionicons name="book-outline" size={14} color={colors.amberDark} />
            {/* One line, ending in "…" when it doesn't fit; the full title is
                on the recipe card it opens. */}
            <Text style={styles.recipeToggleText} numberOfLines={1} ellipsizeMode="tail">
              {post.recipe.title}
            </Text>
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

      <ActionSheet
        visible={menuOpen}
        title={post.user?.handle ? `@${post.user.handle}` : undefined}
        onClose={() => setMenuOpen(false)}
        actions={menuActions}
      />
    </Pressable>
  );
}

/**
 * Memoised: a post only re-renders when its own data or handlers change, not
 * whenever the list around it does. Pinch-zooming locks and unlocks the list's
 * scrolling, and without this every post on screen re-rendered at both ends
 * of the pinch, which made zooming stutter.
 */
export const PostCard = React.memo(PostCardView);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    overflow: 'hidden',
    ...(shadow as object),
  },
  photoWrap: { position: 'relative' },
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
    // Hugs a short title, but never wider than the card: a long one used to
    // push the bubble (and its arrow) off the right edge.
    alignSelf: 'flex-start',
    maxWidth: '100%',
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
    flexShrink: 1,
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.amberDark,
  },
});
