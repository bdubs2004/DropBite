import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Avatar } from '../components/Avatar';
import { PostPhoto } from '../components/PostPhoto';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { Post } from '../types';

/**
 * Instagram-style long-press peek: a floating preview of a post, opened by
 * holding a thumbnail in any grid. Tapping the backdrop dismisses it; tapping
 * anywhere on the card opens the full post, except the author row, which goes
 * to their profile. The quick actions like/comment/share/save in place without
 * leaving the grid you were browsing.
 *
 * The card is one big Pressable, with the author row and each action as nested
 * Pressables. A press on a child is consumed by that child and never reaches
 * the card, so tapping a button does its own thing while tapping the photo,
 * blurb, or any gap opens the post — no explicit "Open post" button needed.
 */
export function PostPeekScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const postId: string = route.params.postId;
  const svc = getDataService();
  const { user } = useApp();
  // Tallest the photo can be and still leave room for the rest of the card
  // (about 320pt: header, blurb, buttons, margins). On a big phone that's a
  // full 3:4 photo; on a small one the photo fits inside a shorter frame.
  const { width: winW, height: winH } = useWindowDimensions();
  const cardW = Math.min(winW - spacing.lg * 2, 420);
  const photoMax = Math.max(0.75, (winH - 320) / cardW);

  const [post, setPost] = useState<Post | null>(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const p = await svc.getPost(postId);
    setPost(p);
    if (p) {
      setLiked(!!p.reacted_by_me);
      setLikeCount(p.reaction_count ?? 0);
      setSaved(!!p.saved_by_me);
    }
  }, [svc, postId]);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => navigation.goBack();

  const goTo = (screen: string, params: object) => {
    navigation.goBack();
    navigation.navigate(screen, params);
  };

  // Comments open *over the post*, not over the grid: dismiss the peek, open the
  // post, and let PostDetail slide the comments sheet up on top of it. So
  // backing out of comments lands you on the post, the way it does everywhere
  // else — not straight back to the grid.
  const openComments = () => {
    navigation.goBack();
    navigation.navigate('PostDetail', { postId, openComments: true });
  };

  const like = () => {
    // Your own post: the heart shows who liked it, like on the full post.
    if (post && post.user_id === user?.id) {
      navigation.goBack();
      navigation.navigate('UserList', { mode: 'post_likes', postId });
      return;
    }
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    svc.toggleReaction(postId).catch(() => load());
  };

  const save = () => {
    const next = !saved;
    setSaved(next);
    svc.toggleSave(postId).catch(() => load());
  };

  const slot = post ? colors.meal[post.meal_slot] : null;

  return (
    <View style={styles.root}>
      {/* The screen behind goes soft, like Instagram's preview, so the post
          stands out. Frosted, not darkened: light mode stays light. */}
      <BlurView
        testID="peek-blur"
        intensity={45}
        tint={colors.dark ? 'dark' : 'light'}
        style={styles.backdrop}
        pointerEvents="none"
      />
      <Pressable testID="peek-backdrop" style={styles.backdrop} onPress={close} />
      <View style={styles.card} pointerEvents="box-none">
        {!post ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.amber} />
          </View>
        ) : (
          <Pressable
            testID="peek-open"
            style={styles.sheet}
            onPress={() => goTo('PostDetail', { postId })}
          >
            {/* author */}
            <View style={styles.header}>
              <Pressable
                style={styles.authorRow}
                onPress={() => goTo('UserProfile', { userId: post.user_id })}
              >
                <Avatar user={post.user} size={38} />
                <View style={{ marginLeft: spacing.md, flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {post.user?.display_name ?? 'Someone'}
                  </Text>
                  <Text style={styles.handle} numberOfLines={1}>
                    @{post.user?.handle ?? 'unknown'}
                  </Text>
                </View>
              </Pressable>
              {slot ? (
                <View style={[styles.slotPill, { backgroundColor: slot.bg }]}>
                  <Text style={[styles.slotText, { color: slot.color }]}>{slot.label}</Text>
                </View>
              ) : null}
            </View>

            {/* The whole photo at its own shape, as tall as the screen allows
                with the header, words and buttons around it. */}
            <PostPhoto post={post} maxRatio={photoMax} />

            {post.blurb ? (
              <Text style={styles.blurb} numberOfLines={3}>
                <Text style={styles.blurbHandle}>{post.user?.handle ?? ''} </Text>
                {post.blurb}
              </Text>
            ) : null}

            {/* quick actions */}
            <View style={styles.actions}>
              <Pressable testID="peek-like" style={styles.action} onPress={like} hitSlop={8}>
                <Ionicons
                  name={liked ? 'heart' : 'heart-outline'}
                  size={24}
                  color={liked ? colors.danger : colors.cocoaSoft}
                />
                <Text style={styles.actionLabel}>{likeCount}</Text>
              </Pressable>
              <Pressable
                testID="peek-comment"
                style={styles.action}
                onPress={openComments}
                hitSlop={8}
              >
                <Ionicons name="chatbubble-outline" size={22} color={colors.cocoaSoft} />
                <Text style={styles.actionLabel}>{post.comment_count ?? 0}</Text>
              </Pressable>
              <Pressable
                testID="peek-share"
                style={styles.action}
                onPress={() => goTo('ShareSheet', { postId })}
                hitSlop={8}
              >
                <Ionicons name="paper-plane-outline" size={22} color={colors.cocoaSoft} />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable testID="peek-save" style={styles.action} onPress={save} hitSlop={8}>
                <Ionicons
                  name={saved ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={saved ? colors.amberDark : colors.cocoaSoft}
                />
              </Pressable>
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors, { shadow }) => ({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Tapping outside the preview closes it.
  },
  card: { width: '100%', maxWidth: 420, alignItems: 'stretch' },
  loading: { padding: spacing.xxl, alignItems: 'center' },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...(shadow as object),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  handle: { fontFamily: fonts.semi, fontSize: 12, color: colors.cocoaFaint, marginTop: 1 },
  slotPill: { borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
  slotText: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.3 },
  blurb: {
    fontFamily: fonts.semi,
    fontSize: 15,
    lineHeight: 21,
    color: colors.cocoa,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  blurbHandle: { fontFamily: fonts.bold, color: colors.cocoa },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md + spacing.xs,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoaSoft },
}));
