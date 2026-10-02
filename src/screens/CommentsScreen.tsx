import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionSheet } from '../components/ActionSheet';
import { Avatar } from '../components/Avatar';
import { Muted } from '../components/ui';
import { LIMITS } from '../lib/limits';
import { pickImage } from '../lib/pickImage';
import { relativeTime } from '../lib/time';
import { useKeyboardVisible } from '../lib/useKeyboardVisible';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';
import { Comment } from '../types';

/** Top-level comments loaded per page; more load as you scroll. */
const PAGE = 15;

/**
 * Comments as an Instagram-style bottom sheet: a rounded panel over a dimmed
 * backdrop (drag it down to dismiss), with threaded replies and paged loading
 * so a post with hundreds of comments doesn't fetch them all at once.
 */
export function CommentsScreen({ navigation, route }: any) {
  const postId: string = route.params.postId;
  const svc = getDataService();
  const { user, refreshFeed } = useApp();
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();
  const inputRef = useRef<TextInput>(null);

  const [threads, setThreads] = useState<Comment[]>([]);
  const [replies, setReplies] = useState<Record<string, Comment[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<{ parentId: string; handle: string } | null>(null);

  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [posting, setPosting] = useState(false);
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [confirming, setConfirming] = useState<Comment | null>(null);

  const close = () => navigation.goBack();

  // Tapping a commenter's avatar or handle opens their profile, like Instagram.
  const openProfile = (userId: string) => navigation.navigate('UserProfile', { userId });

  // Drag the sheet down to dismiss.
  const translateY = useRef(new Animated.Value(0)).current;
  const dragDown = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120 || g.vy > 0.6) {
          Animated.timing(translateY, { toValue: 900, duration: 160, useNativeDriver: true }).start(
            () => navigation.goBack(),
          );
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9, tension: 80 }).start();
        }
      },
    }),
  ).current;

  const loadFirst = useCallback(async () => {
    setLoading(true);
    const first = await svc.getComments(postId, PAGE, 0);
    setThreads(first);
    setHasMore(first.length === PAGE);
    setLoading(false);
  }, [svc, postId]);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const next = await svc.getComments(postId, PAGE, threads.length);
      setThreads((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...next.filter((n) => !seen.has(n.id))];
      });
      setHasMore(next.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleReplies = async (c: Comment) => {
    const id = c.id;
    if (expanded.has(id)) {
      setExpanded((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      return;
    }
    setExpanded((prev) => new Set(prev).add(id));
    if (!replies[id]) {
      setLoadingReplies((prev) => new Set(prev).add(id));
      try {
        const r = await svc.getReplies(id);
        setReplies((prev) => ({ ...prev, [id]: r }));
      } finally {
        setLoadingReplies((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    }
  };

  const startReply = (c: Comment) => {
    // Replying to a reply attaches to its top-level parent (two levels only).
    setReplyTo({ parentId: c.parent_id ?? c.id, handle: c.user?.handle ?? '' });
    inputRef.current?.focus();
  };

  const attach = async (fromCamera: boolean) => {
    const res = await pickImage({ fromCamera, aspect: [4, 5], width: 1200 });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    if (res.uri) setPhoto(res.uri);
  };

  const removeComment = async (c: Comment) => {
    if (c.parent_id) {
      const pid = c.parent_id;
      setReplies((prev) => ({ ...prev, [pid]: (prev[pid] ?? []).filter((x) => x.id !== c.id) }));
      setThreads((prev) =>
        prev.map((t) => (t.id === pid ? { ...t, reply_count: Math.max(0, (t.reply_count ?? 1) - 1) } : t)),
      );
    } else {
      setThreads((prev) => prev.filter((x) => x.id !== c.id));
    }
    try {
      await svc.deleteComment(c.id);
      refreshFeed();
    } catch {
      loadFirst();
    }
  };

  const toggleLike = async (c: Comment) => {
    const liked = !c.liked_by_me;
    const upd = (x: Comment) =>
      x.id === c.id ? { ...x, liked_by_me: liked, like_count: (x.like_count ?? 0) + (liked ? 1 : -1) } : x;
    if (c.parent_id) {
      const pid = c.parent_id;
      setReplies((prev) => ({ ...prev, [pid]: (prev[pid] ?? []).map(upd) }));
    } else {
      setThreads((prev) => prev.map(upd));
    }
    try {
      await svc.toggleCommentLike(c.id);
    } catch {
      loadFirst();
    }
  };

  const submit = async () => {
    const body = text.trim();
    if ((!body && !photo) || posting) return;
    setPosting(true);
    const parentId = replyTo?.parentId ?? null;
    try {
      const created = await svc.addComment(postId, body, photo ?? undefined, parentId);
      setText('');
      setPhoto(null);
      setReplyTo(null);
      if (parentId) {
        // Re-pull the thread so it includes the new reply, and keep it open.
        const r = await svc.getReplies(parentId);
        setReplies((prev) => ({ ...prev, [parentId]: r }));
        setExpanded((prev) => new Set(prev).add(parentId));
        setThreads((prev) => prev.map((t) => (t.id === parentId ? { ...t, reply_count: r.length } : t)));
      } else {
        setThreads((prev) => [
          { ...created, can_delete: true, like_count: 0, liked_by_me: false, reply_count: 0 },
          ...prev,
        ]);
      }
      refreshFeed();
    } catch (e: any) {
      setNotice(e?.message ?? 'That comment could not be posted.');
    } finally {
      setPosting(false);
    }
  };

  const canSend = (text.trim().length > 0 || photo !== null) && !posting;

  const row = (c: Comment, indented: boolean) => (
    <Pressable
      key={c.id}
      testID={`comment-${c.id}`}
      style={[styles.row, indented && styles.rowIndented]}
      onLongPress={() => (c.can_delete || c.user_id !== user?.id) && setMenuFor(c)}
      delayLongPress={350}
    >
      <Pressable
        testID={`comment-avatar-${c.id}`}
        onPress={() => c.user_id && openProfile(c.user_id)}
        hitSlop={6}
      >
        <Avatar user={c.user} size={indented ? 28 : 34} />
      </Pressable>
      <View style={styles.body}>
        <Text style={styles.text}>
          <Text
            style={styles.handle}
            onPress={() => c.user_id && openProfile(c.user_id)}
            suppressHighlighting
          >
            {c.user?.handle ?? 'unknown'}
          </Text>{' '}
          {c.text}
        </Text>
        {c.image_url ? (
          <Image
            testID={`comment-photo-${c.id}`}
            source={{ uri: c.image_url }}
            style={styles.commentPhoto}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
          />
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.time}>{relativeTime(c.created_at)}</Text>
          {c.like_count ? (
            <Pressable
              testID={`comment-likes-${c.id}`}
              onPress={() => navigation.navigate('UserList', { mode: 'comment_likes', commentId: c.id })}
              hitSlop={8}
            >
              <Text style={styles.metaCount}>
                {c.like_count} {c.like_count === 1 ? 'like' : 'likes'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable testID={`comment-reply-${c.id}`} onPress={() => startReply(c)} hitSlop={8}>
            <Text style={styles.metaAction}>Reply</Text>
          </Pressable>
          {c.can_delete ? (
            <Pressable testID={`comment-menu-${c.id}`} onPress={() => setMenuFor(c)} hitSlop={8}>
              <Text style={styles.metaAction}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Pressable
        testID={`comment-like-${c.id}`}
        onPress={() => toggleLike(c)}
        hitSlop={10}
        style={styles.likeBtn}
      >
        <Ionicons
          name={c.liked_by_me ? 'heart' : 'heart-outline'}
          size={15}
          color={c.liked_by_me ? colors.danger : colors.cocoaFaint}
        />
      </Pressable>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <Pressable
          testID="comments-backdrop"
          style={styles.backdrop}
          onPress={close}
          accessibilityLabel="Close comments"
        />
        <View style={styles.spacer} pointerEvents="none" />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.panel}>
            <View {...dragDown.panHandlers}>
              <View style={styles.grabber} />
              <View style={styles.header}>
                <Text style={styles.title}>Comments</Text>
                <Pressable testID="comments-close" onPress={close} hitSlop={10} style={styles.closeBtn}>
                  <Ionicons name="close" size={22} color={colors.cocoaSoft} />
                </Pressable>
              </View>
            </View>

            <FlatList
              style={{ flex: 1 }}
              data={threads}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onEndReachedThreshold={0.4}
              onEndReached={loadMore}
              renderItem={({ item }) => (
                <View>
                  {row(item, false)}
                  {item.reply_count ? (
                    <Pressable
                      testID={`comment-replies-${item.id}`}
                      onPress={() => toggleReplies(item)}
                      style={styles.repliesToggle}
                      hitSlop={6}
                    >
                      <View style={styles.replyLine} />
                      <Text style={styles.repliesToggleText}>
                        {expanded.has(item.id)
                          ? 'Hide replies'
                          : `View ${item.reply_count} ${item.reply_count === 1 ? 'reply' : 'replies'}`}
                      </Text>
                    </Pressable>
                  ) : null}
                  {expanded.has(item.id)
                    ? loadingReplies.has(item.id) && !replies[item.id]
                      ? (
                        <ActivityIndicator
                          color={colors.amber}
                          style={{ marginLeft: 46, marginVertical: spacing.sm }}
                        />
                      )
                      : (replies[item.id] ?? []).map((r) => row(r, true))
                    : null}
                </View>
              )}
              ListFooterComponent={
                loadingMore ? (
                  <ActivityIndicator color={colors.amber} style={{ marginVertical: spacing.md }} />
                ) : null
              }
              ListEmptyComponent={
                loading ? (
                  <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
                ) : (
                  <View style={styles.empty}>
                    <Ionicons name="chatbubble-outline" size={38} color={colors.cocoaFaint} />
                    <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>
                      No comments yet. Be the first to say something.
                    </Muted>
                  </View>
                )
              }
            />
          </View>

          {notice ? (
            <Pressable testID="comment-notice" onPress={() => setNotice(null)} style={styles.notice}>
              <Text style={styles.noticeText}>{notice}</Text>
              <Ionicons name="close" size={16} color={colors.cocoaSoft} />
            </Pressable>
          ) : null}

          {replyTo ? (
            <View style={styles.replyBar}>
              <Text style={styles.replyBarText}>Replying to @{replyTo.handle}</Text>
              <Pressable testID="reply-cancel" onPress={() => setReplyTo(null)} hitSlop={10}>
                <Ionicons name="close" size={16} color={colors.cocoaSoft} />
              </Pressable>
            </View>
          ) : null}

          {photo ? (
            <View style={styles.staged}>
              <Image source={{ uri: photo }} style={styles.stagedThumb} contentFit="cover" />
              <Text style={styles.stagedLabel}>Photo ready to post</Text>
              <Pressable
                testID="comment-photo-remove"
                onPress={() => setPhoto(null)}
                hitSlop={10}
                accessibilityLabel="Remove photo"
              >
                <Ionicons name="close-circle" size={22} color={colors.cocoaFaint} />
              </Pressable>
            </View>
          ) : null}

          <View
            style={[
              styles.composer,
              { paddingBottom: keyboardUp ? spacing.md : Math.max(insets.bottom, spacing.md) },
            ]}
          >
            {/* The composer's background runs on down behind the keyboard, so
                there's no transparent sliver showing the feed between the bar
                and the keyboard (or in the corners) when the keyboard is up.
                It's anchored at the composer's bottom edge, so with the keyboard
                down it sits off the bottom of the screen and never shows. */}
            <View pointerEvents="none" style={styles.kbFill} />
            <Avatar user={user} size={32} />
            <Pressable
              testID="comment-attach"
              onPress={() => attach(false)}
              onLongPress={() => attach(true)}
              delayLongPress={300}
              style={styles.attach}
              accessibilityLabel="Add a photo from your library. Hold for camera."
            >
              <Ionicons name="image-outline" size={22} color={colors.amberDark} />
            </Pressable>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              placeholder={replyTo ? `Reply to @${replyTo.handle}` : 'Add a comment'}
              placeholderTextColor={colors.cocoaFaint}
              style={styles.input}
              multiline
              maxLength={LIMITS.comment}
            />
            <Pressable
              testID="comment-send"
              onPress={submit}
              disabled={!canSend}
              style={[styles.send, !canSend && { opacity: 0.4 }]}
            >
              <Ionicons name="arrow-up" size={20} color={colors.white} />
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={menuFor !== null}
        title="Comment"
        onClose={() => setMenuFor(null)}
        actions={[
          ...(menuFor?.can_delete
            ? [
                {
                  key: 'delete-comment',
                  label: 'Delete comment',
                  hint:
                    menuFor && menuFor.user_id !== user?.id
                      ? 'You can remove comments on your own post'
                      : undefined,
                  icon: 'trash-outline',
                  destructive: true,
                  onPress: () => {
                    const target = menuFor;
                    if (!target) return;
                    if (Platform.OS === 'web') {
                      setConfirming(target);
                      return;
                    }
                    Alert.alert('Delete comment?', 'This cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => removeComment(target) },
                    ]);
                  },
                },
              ]
            : []),
          ...(menuFor && menuFor.user_id !== user?.id
            ? [
                {
                  key: 'report-comment',
                  label: 'Report comment',
                  hint: 'Send this to our moderation team',
                  icon: 'flag-outline',
                  destructive: true,
                  onPress: () => {
                    const target = menuFor;
                    if (target) navigation.navigate('Report', { commentId: target.id });
                  },
                },
              ]
            : []),
        ]}
      />

      {confirming ? (
        <View style={[styles.confirmBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Text style={styles.confirmText}>Delete this comment?</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              testID="comment-delete-cancel"
              onPress={() => setConfirming(null)}
              style={[styles.confirmBtn, styles.confirmCancel]}
            >
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="comment-delete-confirm"
              onPress={() => {
                const target = confirming;
                setConfirming(null);
                if (target) removeComment(target);
              }}
              style={[styles.confirmBtn, styles.confirmDelete]}
            >
              <Text style={styles.confirmDeleteText}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  kav: { flex: 1 },
  // No dim — the sheet just overlays the feed. Still tappable to close.
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  spacer: { flex: 1.3 },
  sheet: { flex: 6 },
  panel: {
    flex: 1,
    backgroundColor: colors.cream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.creamDark,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  likeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: spacing.sm,
    paddingTop: 2,
    minWidth: 26,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  closeBtn: { position: 'absolute', right: spacing.lg, top: 0, padding: 2 },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  rowIndented: { marginLeft: 44 },
  body: { flex: 1, marginLeft: spacing.md },
  handle: { fontFamily: fonts.bold, color: colors.cocoa },
  text: { fontFamily: fonts.semi, fontSize: 14.5, lineHeight: 20, color: colors.cocoa },
  commentPhoto: {
    width: 150,
    height: 188,
    borderRadius: 12,
    marginTop: spacing.sm,
    backgroundColor: colors.creamDark,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 4 },
  time: { fontFamily: fonts.semi, fontSize: 11.5, color: colors.cocoaFaint },
  metaCount: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.cocoaFaint },
  metaAction: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.cocoaFaint },
  repliesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: 44,
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
  },
  replyLine: { width: 22, height: 1, backgroundColor: colors.creamDark },
  repliesToggleText: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.cocoaSoft },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.creamDark,
  },
  noticeText: { flex: 1, fontFamily: fonts.semi, fontSize: 13, color: colors.cocoa },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.creamDark,
  },
  replyBarText: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.cocoaSoft },
  staged: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  stagedThumb: { width: 42, height: 52, borderRadius: 8, backgroundColor: colors.creamDark },
  stagedLabel: { flex: 1, fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoa },
  confirmBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderColor: colors.creamDark,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  confirmText: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.cocoa },
  confirmBtn: { borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  confirmCancel: { backgroundColor: colors.creamDark },
  confirmCancelText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoa },
  confirmDelete: { backgroundColor: colors.danger },
  confirmDeleteText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.white },
  empty: { alignItems: 'center', marginTop: 60 },
  attach: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.white,
  },
  kbFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    height: 900,
    backgroundColor: colors.white,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontFamily: fonts.semi,
    fontSize: 15,
    color: colors.cocoa,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
