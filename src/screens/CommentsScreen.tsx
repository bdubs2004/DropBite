import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
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
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';
import { Comment } from '../types';

/**
 * Comments as an Instagram-style bottom sheet: a rounded panel that rises from
 * the bottom over a dimmed backdrop, so the post stays visible behind it. Built
 * by hand (over a transparent modal) rather than a native sheet so it looks the
 * same opened from the feed, a profile, Discover, or a post page.
 */
export function CommentsScreen({ navigation, route }: any) {
  const postId: string = route.params.postId;
  const svc = getDataService();
  const { user, refreshFeed } = useApp();
  const insets = useSafeAreaInsets();

  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [confirming, setConfirming] = useState<Comment | null>(null);

  const close = () => navigation.goBack();

  const load = useCallback(async () => {
    setComments(await svc.getComments(postId));
    setLoading(false);
  }, [svc, postId]);

  useEffect(() => {
    load();
  }, [load]);

  const attach = async (fromCamera: boolean) => {
    const res = await pickImage({ fromCamera, aspect: [4, 5], width: 1200 });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    if (res.uri) setPhoto(res.uri);
  };

  const removeComment = async (c: Comment) => {
    setComments((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await svc.deleteComment(c.id);
      refreshFeed();
    } catch {
      load();
    }
  };

  const toggleLike = async (comment: Comment) => {
    const liked = !comment.liked_by_me;
    setComments((prev) =>
      prev.map((c) =>
        c.id === comment.id
          ? { ...c, liked_by_me: liked, like_count: (c.like_count ?? 0) + (liked ? 1 : -1) }
          : c,
      ),
    );
    try {
      await svc.toggleCommentLike(comment.id);
    } catch {
      load();
    }
  };

  const submit = async () => {
    const body = text.trim();
    if ((!body && !photo) || posting) return;
    setPosting(true);
    try {
      await svc.addComment(postId, body, photo ?? undefined);
      setText('');
      setPhoto(null);
      await load();
      refreshFeed();
    } catch (e: any) {
      setNotice(e?.message ?? 'That comment could not be posted.');
    } finally {
      setPosting(false);
    }
  };

  const canSend = (text.trim().length > 0 || photo !== null) && !posting;

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
        {/* Spacer sizes the gap above the sheet; taps fall through to the
            backdrop behind it. */}
        <View style={styles.spacer} pointerEvents="none" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>Comments</Text>
            <Pressable
              testID="comments-close"
              onPress={close}
              hitSlop={10}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={colors.cocoaSoft} />
            </Pressable>
          </View>

          <FlatList
            style={{ flex: 1 }}
            data={comments}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item }) => (
              <Pressable
                testID={`comment-${item.id}`}
                style={styles.row}
                onLongPress={() =>
                  (item.can_delete || item.user_id !== user?.id) && setMenuFor(item)
                }
                delayLongPress={350}
              >
                <Avatar user={item.user} size={34} />
                <View style={styles.body}>
                  <Text style={styles.text}>
                    <Text style={styles.handle}>{item.user?.handle ?? 'unknown'} </Text>
                    {item.text}
                  </Text>
                  {item.image_url ? (
                    <Image
                      testID={`comment-photo-${item.id}`}
                      source={{ uri: item.image_url }}
                      style={styles.commentPhoto}
                      resizeMode="cover"
                    />
                  ) : null}
                  <View style={styles.metaRow}>
                    <Text style={styles.time}>{relativeTime(item.created_at)}</Text>
                    {item.like_count ? (
                      <Text testID={`comment-like-count-${item.id}`} style={styles.metaCount}>
                        {item.like_count} {item.like_count === 1 ? 'like' : 'likes'}
                      </Text>
                    ) : null}
                    {item.can_delete ? (
                      <Pressable
                        testID={`comment-menu-${item.id}`}
                        onPress={() => setMenuFor(item)}
                        hitSlop={8}
                      >
                        <Text style={styles.metaAction}>Delete</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <Pressable
                  testID={`comment-like-${item.id}`}
                  onPress={() => toggleLike(item)}
                  hitSlop={10}
                  style={styles.likeBtn}
                >
                  <Ionicons
                    name={item.liked_by_me ? 'heart' : 'heart-outline'}
                    size={15}
                    color={item.liked_by_me ? colors.danger : colors.cocoaFaint}
                  />
                </Pressable>
              </Pressable>
            )}
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.empty}>
                  <Ionicons name="chatbubble-outline" size={38} color={colors.cocoaFaint} />
                  <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>
                    No comments yet. Be the first to say something.
                  </Muted>
                </View>
              )
            }
          />

          {notice ? (
            <Pressable testID="comment-notice" onPress={() => setNotice(null)} style={styles.notice}>
              <Text style={styles.noticeText}>{notice}</Text>
              <Ionicons name="close" size={16} color={colors.cocoaSoft} />
            </Pressable>
          ) : null}

          {photo ? (
            <View style={styles.staged}>
              <Image source={{ uri: photo }} style={styles.stagedThumb} resizeMode="cover" />
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
            style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
          >
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
              value={text}
              onChangeText={setText}
              placeholder="Add a comment"
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
        </View>
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
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => removeComment(target),
                      },
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
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  // Spacer : sheet ≈ 1 : 6, so the sheet fills ~86% and shrinks with the
  // keyboard instead of clipping off the top.
  spacer: { flex: 1 },
  sheet: {
    flex: 6,
    backgroundColor: colors.cream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
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
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cocoa,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  body: { flex: 1, marginLeft: spacing.md },
  handle: {
    fontFamily: fonts.bold,
    color: colors.cocoa,
  },
  text: {
    fontFamily: fonts.semi,
    fontSize: 14.5,
    lineHeight: 20,
    color: colors.cocoa,
  },
  commentPhoto: {
    width: 150,
    height: 188,
    borderRadius: 12,
    marginTop: spacing.sm,
    backgroundColor: colors.creamDark,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: 4,
  },
  time: {
    fontFamily: fonts.semi,
    fontSize: 11.5,
    color: colors.cocoaFaint,
  },
  metaCount: {
    fontFamily: fonts.bold,
    fontSize: 11.5,
    color: colors.cocoaFaint,
  },
  metaAction: {
    fontFamily: fonts.bold,
    fontSize: 11.5,
    color: colors.cocoaFaint,
  },
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
  confirmText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.cocoa,
  },
  confirmBtn: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  confirmCancel: { backgroundColor: colors.creamDark },
  confirmCancelText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoa },
  confirmDelete: { backgroundColor: colors.danger },
  confirmDeleteText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.white },
  empty: {
    alignItems: 'center',
    marginTop: 60,
  },
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
