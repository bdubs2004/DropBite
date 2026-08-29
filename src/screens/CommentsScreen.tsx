import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
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
import { relativeTime } from '../lib/time';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';
import { Comment } from '../types';

export function CommentsScreen({ navigation, route }: any) {
  const postId: string = route.params.postId;
  const svc = getDataService();
  const { user, refreshFeed } = useApp();
  const insets = useSafeAreaInsets();

  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [confirming, setConfirming] = useState<Comment | null>(null);

  const load = useCallback(async () => {
    setComments(await svc.getComments(postId));
    setLoading(false);
  }, [svc, postId]);

  useEffect(() => {
    load();
  }, [load]);

  const removeComment = async (c: Comment) => {
    // Drop it locally first so the row disappears immediately.
    setComments((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await svc.deleteComment(c.id);
      refreshFeed(); // keep the post's comment count honest
    } catch {
      load(); // put it back if the write failed
    }
  };

  /**
   * Optimistic like: the heart flips instantly, then persists. Waiting on a
   * round-trip to redraw a heart feels broken.
   */
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
      load(); // put the truth back if the write failed
    }
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await svc.addComment(postId, body);
      setText('');
      await load();
      // keep the feed's comment count in sync
      refreshFeed();
    } finally {
      setPosting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
        <Text style={styles.title}>Comments</Text>
        <View style={{ width: 48 }} />
      </View>

      <FlatList
        data={comments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
        renderItem={({ item }) => (
          <Pressable
            testID={`comment-${item.id}`}
            style={styles.row}
            onLongPress={() => item.can_delete && setMenuFor(item)}
            delayLongPress={350}
          >
            <Avatar user={item.user} size={34} />
            <View style={styles.body}>
              {/* Handle inline ahead of the text, the way the feed reads. */}
              <Text style={styles.text}>
                <Text style={styles.handle}>{item.user?.handle ?? 'unknown'} </Text>
                {item.text}
              </Text>
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

      <ActionSheet
        visible={menuFor !== null}
        title="Comment"
        onClose={() => setMenuFor(null)}
        actions={[
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
        ]}
      />

      {confirming ? (
        <View style={styles.confirmBar}>
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

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Avatar user={user} size={34} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Add a comment"
          placeholderTextColor={colors.cocoaFaint}
          style={styles.input}
          multiline
          maxLength={LIMITS.comment}
          onSubmitEditing={submit}
        />
        <Pressable
          testID="comment-send"
          onPress={submit}
          disabled={!text.trim() || posting}
          style={[styles.send, (!text.trim() || posting) && { opacity: 0.4 }]}
        >
          <Ionicons name="arrow-up" size={20} color={colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  close: {
    fontFamily: fonts.bold,
    color: colors.cocoaSoft,
    fontSize: 15,
    width: 48,
  },
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
