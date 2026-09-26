import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { PostPhoto } from '../components/PostPhoto';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, MEAL_SLOT_META, radius, shadow, spacing } from '../theme';
import { Post } from '../types';

/**
 * Instagram-style long-press peek: a floating preview of a post with quick
 * actions, opened by holding a thumbnail in any grid. Tapping the backdrop or
 * "Open post" dismisses it; the quick actions like/comment/share/save without
 * leaving the grid you were browsing.
 */
export function PostPeekScreen({ navigation, route }: any) {
  const postId: string = route.params.postId;
  const svc = getDataService();
  const { user } = useApp();

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

  const like = () => {
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

  const slot = post ? MEAL_SLOT_META[post.meal_slot] : null;

  return (
    <View style={styles.root}>
      <Pressable testID="peek-backdrop" style={styles.backdrop} onPress={close} />
      <View style={styles.card} pointerEvents="box-none">
        {!post ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.amber} />
          </View>
        ) : (
          <View style={styles.sheet}>
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

            <PostPhoto post={post} ratio={1} />

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
                onPress={() => goTo('Comments', { postId })}
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

            <Pressable
              testID="peek-open"
              style={styles.openBtn}
              onPress={() => goTo('PostDetail', { postId })}
            >
              <Text style={styles.openText}>Open post</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.white} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  card: { width: '100%', maxWidth: 420, alignItems: 'stretch' },
  loading: { padding: spacing.xxl, alignItems: 'center' },
  sheet: {
    backgroundColor: colors.white,
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
    paddingVertical: spacing.md,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoaSoft },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.amber,
    paddingVertical: 14,
  },
  openText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
