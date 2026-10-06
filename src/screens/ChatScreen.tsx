import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionSheet } from '../components/ActionSheet';
import { Avatar } from '../components/Avatar';
import { ConversationDetailsSheet } from '../components/ConversationDetailsSheet';
import { PhotoViewer } from '../components/PhotoViewer';
import { PostThumb } from '../components/PostThumb';
import { RenameGroupSheet } from '../components/RenameGroupSheet';
import { Muted } from '../components/ui';
import { buildTimeline, clockTime, leftLine, TimelineItem } from '../lib/chatTimeline';
import { makeTapHandler, TapHandler } from '../lib/doubleTap';
import { pickImage } from '../lib/pickImage';
import { useKeyboardVisible } from '../lib/useKeyboardVisible';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, MEAL_SLOT_META, radius, spacing } from '../theme';
import { Message, User } from '../types';

/** Bubble width for an attached photo, and the height of its 4:5 frame. */
const PHOTO_W = 190;

/** A shared-post card fills most of the bubble so it doesn't leave dead space. */
const SHARED_W = Math.min(320, Math.round(Dimensions.get('window').width * 0.78));

/** How far the conversation slides to show each message's time. */
const REVEAL_W = 76;

/** The quick reactions offered when you long-press a message. */
const REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👍'];

/** Group a message's reactions into emoji + count, most used first. */
function tally(reactions: Message['reactions'], meId?: string) {
  const counts = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of reactions ?? []) {
    const row = counts.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    row.count += 1;
    if (r.user_id === meId) row.mine = true;
    counts.set(r.emoji, row);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * One DM thread. Messages can be text, a shared post, a photo, or a mix.
 *
 * Double-tap a message to heart it (again to take it back), long-press for
 * the other reactions, tap a photo to open it full screen, and drag the
 * conversation down to put the keyboard away.
 *
 * Timestamps work like Instagram's: a centred label where the day changes,
 * and drag the conversation to the left to slide every message over and show
 * its exact time. Left, not right, because a swipe right from the edge is
 * iOS's "go back".
 */
export function ChatScreen({ navigation, route }: any) {
  const {
    conversationId,
    title: initialTitle,
    isGroup,
    fallbackTitle,
  } = route.params as {
    conversationId: string;
    title?: string;
    isGroup?: boolean;
    /** Members' names, to revert to if the custom name is cleared. */
    fallbackTitle?: string;
  };
  const svc = getDataService();
  const { user } = useApp();
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();
  const listRef = useRef<FlatList<TimelineItem>>(null);

  // Swipe-to-reveal times. One shared value moves every row at once, so the
  // drag never re-renders the list.
  const reveal = useRef(new Animated.Value(0)).current;
  const swipe = useRef(
    PanResponder.create({
      // Only a clearly sideways, leftward drag; vertical scrolling and taps
      // are left alone.
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => reveal.setValue(Math.max(-REVEAL_W, Math.min(0, g.dx))),
      onPanResponderRelease: () =>
        Animated.spring(reveal, { toValue: 0, friction: 8, useNativeDriver: true }).start(),
      onPanResponderTerminate: () =>
        Animated.spring(reveal, { toValue: 0, friction: 8, useNativeDriver: true }).start(),
    }),
  ).current;
  const timeOpacity = reveal.interpolate({
    inputRange: [-REVEAL_W, -REVEAL_W / 3, 0],
    outputRange: [1, 0.4, 0],
    extrapolate: 'clamp',
  });
  const timeShift = Animated.add(reveal, REVEAL_W);

  // Header title lives in state so renaming updates it without a reload.
  const [title, setTitle] = useState(initialTitle ?? 'Chat');
  const [renaming, setRenaming] = useState(false);
  const fallback = fallbackTitle ?? 'Group';

  const saveName = async (name: string) => {
    setRenaming(false);
    const prev = title;
    const trimmed = name.trim();
    setTitle(trimmed || fallback);
    try {
      await svc.renameConversation(conversationId, trimmed);
    } catch {
      setTitle(prev); // put it back if the write failed
    }
  };

  // Details sheet: who's in the thread + mute toggle.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [members, setMembers] = useState<User[]>([]);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      svc.getConversationMembers(conversationId),
      svc.getConversationMuted(conversationId),
    ])
      .then(([m, mu]) => {
        if (!alive) return;
        setMembers(m);
        setMuted(mu);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [svc, conversationId]);

  // Leave the group: everyone still in it sees "<you> left the chat", and
  // you're taken back to your inbox, where the thread is gone.
  const leaveGroup = async () => {
    try {
      await svc.leaveConversation(conversationId);
      setDetailsOpen(false);
      navigation.goBack();
    } catch (e: any) {
      setDetailsOpen(false);
      setNotice(e?.message ?? 'Could not leave the chat. Try again.');
    }
  };

  const toggleMute = async (next: boolean) => {
    setMuted(next); // optimistic
    try {
      await svc.setConversationMuted(conversationId, next);
    } catch {
      setMuted(!next);
    }
  };

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // A photo staged in the composer, not sent yet — same "review before you
  // send" shape as compose, so a mis-tap costs nothing.
  const [photo, setPhoto] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Long-pressed message: the reaction row (and Report, for theirs).
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  // The photo open full screen, if any.
  const [viewing, setViewing] = useState<string | null>(null);

  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const timeline = useMemo(() => buildTimeline(messages), [messages]);

  /** Set (or with null, clear) my reaction on a message. Optimistic. */
  const react = useCallback(
    async (messageId: string, emoji: string | null) => {
      if (!user) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                reactions: [
                  ...(m.reactions ?? []).filter((r) => r.user_id !== user.id),
                  ...(emoji ? [{ user_id: user.id, emoji }] : []),
                ],
              },
        ),
      );
      try {
        await svc.reactToMessage(messageId, emoji);
      } catch (e: any) {
        setNotice(e?.message ?? 'Could not react to that message');
        load();
      }
    },
    // load is stable per conversation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [svc, user],
  );

  const myReaction = (m: Message) => m.reactions?.find((r) => r.user_id === user?.id)?.emoji;

  /** Double-tap: heart it, or take the heart back off. */
  const toggleHeart = useCallback(
    (messageId: string) => {
      const m = messagesRef.current.find((x) => x.id === messageId);
      if (!m) return;
      react(messageId, myReaction(m) === '❤️' ? null : '❤️');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [react, user],
  );

  // One tap tracker per message (and per photo, which also opens on one tap).
  const tapHandlers = useRef(new Map<string, TapHandler>());
  const tapsFor = (key: string, messageId: string, onSingle?: () => void) => {
    let h = tapHandlers.current.get(key);
    if (!h) {
      h = makeTapHandler({ onDouble: () => toggleHeart(messageId), onSingle });
      tapHandlers.current.set(key, h);
    }
    return h;
  };

  const load = useCallback(async () => {
    setMessages(await svc.getMessages(conversationId));
    // Opening the thread is what clears its unread badge.
    await svc.markConversationRead(conversationId);
  }, [svc, conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  const pullRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const attach = async (fromCamera: boolean) => {
    const res = await pickImage({ fromCamera, aspect: [4, 5], width: 1200 });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    if (res.uri) setPhoto(res.uri);
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !photo) || sending) return;
    setSending(true);
    try {
      await svc.sendMessage(conversationId, {
        text: body || undefined,
        imageUri: photo ?? undefined,
      });
      setText('');
      setPhoto(null);
      await load();
      listRef.current?.scrollToEnd({ animated: true });
    } catch (e: any) {
      setNotice(e?.message ?? 'That message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  const canSend = (text.trim().length > 0 || photo !== null) && !sending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        {isGroup ? (
          <Pressable
            testID="chat-title"
            onPress={() => setRenaming(true)}
            style={styles.titleWrap}
            hitSlop={8}
          >
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Ionicons name="pencil" size={13} color={colors.cocoaFaint} />
          </Pressable>
        ) : (
          <Text style={[styles.title, { flex: 1, marginHorizontal: spacing.sm }]} numberOfLines={1}>
            {title}
          </Text>
        )}
        <Pressable
          testID="chat-details"
          onPress={() => setDetailsOpen(true)}
          hitSlop={10}
          style={styles.detailsBtn}
          accessibilityLabel="Conversation details"
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.cocoaSoft} />
        </Pressable>
      </View>

      <View style={{ flex: 1 }} {...swipe.panHandlers}>
        <FlatList
          ref={listRef}
          testID="chat-list"
          data={timeline}
          keyExtractor={(i) => i.key}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
          // Drag the conversation down to put the keyboard away.
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullRefresh}
              tintColor={colors.amber}
              colors={[colors.amber]}
            />
          }
          renderItem={({ item: entry }) => {
            if (entry.kind === 'day') {
              return (
                <Text testID={`chat-day-${entry.key}`} style={styles.dayDivider}>
                  {entry.label}
                </Text>
              );
            }
            const item = entry.message;
            // Someone left the group: a centred line in the same style as the
            // day labels, not a bubble.
            if (item.kind === 'left') {
              return (
                <Text testID={`chat-left-${item.id}`} style={styles.dayDivider}>
                  {leftLine(item)}
                </Text>
              );
            }
            const mine = item.sender_id === user?.id;
            // A photo — or a shared-post card — on its own reads better as the
            // thing itself, not wrapped in a thick coloured frame.
            const photoOnly = !!item.image_url && !item.text && !item.shared_post_id;
            const sharedOnly =
              !!(item.shared_post_id || item.shared_user_id) && !item.text && !item.image_url;
            // Its shared post or profile was deleted, leaving nothing to show.
            const emptied =
              !item.text &&
              !item.image_url &&
              !item.shared_post_id &&
              !item.shared_user_id &&
              !item.shared_post &&
              !item.shared_user;
            const bare = photoOnly || sharedOnly;
            return (
              <View style={styles.row}>
                <Animated.View style={{ transform: [{ translateX: reveal }] }}>
                  <Pressable
                    testID={`chat-message-${item.id}`}
                    // Double-tap hearts it; long-press opens the reactions (and
                    // Report, on someone else's message).
                    onPress={() => tapsFor(item.id, item.id).tap()}
                    onLongPress={() => {
                      tapsFor(item.id, item.id).cancel();
                      setMenuFor(item);
                    }}
                    delayLongPress={350}
                    style={[styles.bubbleWrap, mine ? styles.wrapMine : styles.wrapTheirs]}
                  >
                    {isGroup && !mine ? (
                      <Text style={styles.senderName} numberOfLines={1}>
                        {item.sender?.display_name ??
                          (item.sender?.handle ? '@' + item.sender.handle : 'Someone')}
                      </Text>
                    ) : null}
                    <View
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubbleTheirs,
                        bare && styles.bubbleBare,
                      ]}
                    >
                      {item.shared_post ? (
                        // Tap the card anywhere to open the post; tap the author bar
                        // to open that person's profile.
                        <Pressable
                          testID={`chat-shared-${item.id}`}
                          onPress={() =>
                            navigation.navigate('PostDetail', { postId: item.shared_post!.id })
                          }
                          style={styles.sharedCard}
                        >
                          <Pressable
                            testID={`chat-shared-author-${item.id}`}
                            style={styles.sharedAuthorRow}
                            onPress={() =>
                              item.shared_post?.user_id &&
                              navigation.navigate('UserProfile', { userId: item.shared_post.user_id })
                            }
                          >
                            <Avatar user={item.shared_post.user} size={28} />
                            <Text style={styles.sharedAuthorName} numberOfLines={1}>
                              {item.shared_post.user?.display_name ??
                                (item.shared_post.user?.handle
                                  ? '@' + item.shared_post.user.handle
                                  : 'Shared post')}
                            </Text>
                          </Pressable>
                          <PostThumb post={item.shared_post} radius={0} style={styles.sharedThumb} />
                          {item.shared_post.blurb || item.shared_post.meal_slot ? (
                            <View style={styles.sharedMeta}>
                              <Text style={styles.sharedBlurb} numberOfLines={2}>
                                {item.shared_post.meal_slot ? (
                                  <Text style={styles.sharedTag}>
                                    {MEAL_SLOT_META[item.shared_post.meal_slot].label}
                                    {item.shared_post.blurb ? '  ' : ''}
                                  </Text>
                                ) : null}
                                {item.shared_post.blurb}
                              </Text>
                            </View>
                          ) : null}
                        </Pressable>
                      ) : item.shared_post_id ? (
                        // The post existed when it was sent but has since been deleted.
                        <Muted style={{ fontStyle: 'italic' }}>This post is no longer available</Muted>
                      ) : null}

                      {item.shared_user ? (
                        // A profile someone sent (Share profile). Tap for their page.
                        <Pressable
                          testID={`chat-shared-profile-${item.id}`}
                          onPress={() =>
                            navigation.navigate('UserProfile', { userId: item.shared_user!.id })
                          }
                          style={styles.profileCard}
                        >
                          <Avatar user={item.shared_user} size={60} />
                          <Text style={styles.profileName} numberOfLines={1}>
                            {item.shared_user.display_name ?? '@' + item.shared_user.handle}
                          </Text>
                          <Text style={styles.profileHandle} numberOfLines={1}>
                            @{item.shared_user.handle}
                          </Text>
                          <View style={styles.profileBtn}>
                            <Text style={styles.profileBtnText}>View profile</Text>
                          </View>
                        </Pressable>
                      ) : null}

                      {emptied ? (
                        <Muted style={{ fontStyle: 'italic' }}>No longer available</Muted>
                      ) : null}

                      {item.image_url ? (
                        // Tap to open full screen; double-tap to heart.
                        <Pressable
                          testID={`chat-photo-${item.id}`}
                          onPress={() =>
                            tapsFor(`photo-${item.id}`, item.id, () => setViewing(item.image_url!)).tap()
                          }
                          onLongPress={() => setMenuFor(item)}
                          delayLongPress={350}
                        >
                          <Image
                            source={{ uri: item.image_url }}
                            style={styles.photo}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            transition={120}
                          />
                        </Pressable>
                      ) : null}

                      {item.text ? (
                        <Text style={[styles.text, mine && styles.textMine]}>{item.text}</Text>
                      ) : null}
                    </View>
                    {item.reactions?.length ? (
                      <View
                        testID={`chat-reactions-${item.id}`}
                        style={[styles.reactions, mine ? styles.reactionsMine : styles.reactionsTheirs]}
                      >
                        {tally(item.reactions, user?.id).map((r) => (
                          <Pressable
                            key={r.emoji}
                            testID={`chat-reaction-${item.id}-${r.emoji}`}
                            // Tap your own to take it off, someone else's to join in.
                            onPress={() => react(item.id, r.mine ? null : r.emoji)}
                            style={[styles.reactionPill, r.mine && styles.reactionPillMine]}
                            hitSlop={4}
                          >
                            <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                            {r.count > 1 ? <Text style={styles.reactionCount}>{r.count}</Text> : null}
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </Pressable>
                </Animated.View>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.swipeTime,
                    { opacity: timeOpacity, transform: [{ translateX: timeShift }] },
                  ]}
                >
                  <Text testID={`chat-time-${item.id}`} style={styles.swipeTimeText}>
                    {clockTime(new Date(item.created_at))}
                  </Text>
                </Animated.View>
              </View>
            );
          }}
          ListEmptyComponent={
            <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
              No messages yet. Say something
            </Muted>
          }
        />
      </View>

      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        header={
          <View testID="reaction-row" style={styles.reactionRow}>
            {REACTIONS.map((emoji) => {
              const on = menuFor ? myReaction(menuFor) === emoji : false;
              return (
                <Pressable
                  key={emoji}
                  testID={`react-${emoji}`}
                  onPress={() => {
                    const target = menuFor;
                    setMenuFor(null);
                    // Picking the one you already left takes it off.
                    if (target) react(target.id, on ? null : emoji);
                  }}
                  style={[styles.reactionChoice, on && styles.reactionChoiceOn]}
                >
                  <Text style={styles.reactionChoiceEmoji}>{emoji}</Text>
                </Pressable>
              );
            })}
          </View>
        }
        actions={
          menuFor && menuFor.sender_id === user?.id
            ? []
            : [
                {
                  key: 'report-message',
                  label: 'Report message',
                  hint: 'Reports are confidential',
                  icon: 'flag-outline',
                  destructive: true,
                  onPress: () => {
                    const target = menuFor;
                    setMenuFor(null);
                    if (target) navigation.navigate('Report', { messageId: target.id });
                  },
                },
              ]
        }
      />

      <PhotoViewer uri={viewing} onClose={() => setViewing(null)} />

      {notice ? (
        <Pressable testID="chat-notice" onPress={() => setNotice(null)} style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
          <Ionicons name="close" size={16} color={colors.cocoaSoft} />
        </Pressable>
      ) : null}

      {photo ? (
        <View style={styles.staged}>
          <Image source={{ uri: photo }} style={styles.stagedThumb} contentFit="cover" />
          <Text style={styles.stagedLabel}>Photo ready to send</Text>
          <Pressable
            testID="chat-photo-remove"
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
        <Pressable
          testID="chat-camera"
          onPress={() => attach(true)}
          style={styles.attach}
          accessibilityLabel="Take a photo"
        >
          <Ionicons name="camera-outline" size={22} color={colors.amberDark} />
        </Pressable>
        <Pressable
          testID="chat-library"
          onPress={() => attach(false)}
          style={styles.attach}
          accessibilityLabel="Choose a photo from your library"
        >
          <Ionicons name="image-outline" size={22} color={colors.amberDark} />
        </Pressable>
        <TextInput
          testID="chat-input"
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={colors.cocoaFaint}
          style={styles.input}
          multiline
          maxLength={2000}
        />
        <Pressable
          testID="chat-send"
          onPress={send}
          disabled={!canSend}
          style={[styles.send, !canSend && { opacity: 0.4 }]}
        >
          <Ionicons name="arrow-up" size={20} color={colors.white} />
        </Pressable>
      </View>

      <RenameGroupSheet
        visible={renaming}
        initial={title === fallback ? '' : title}
        onCancel={() => setRenaming(false)}
        onSave={saveName}
      />

      <ConversationDetailsSheet
        visible={detailsOpen}
        title={title}
        isGroup={!!isGroup}
        members={members}
        muted={muted}
        onToggleMute={toggleMute}
        onLeave={leaveGroup}
        onOpenProfile={(uid) => {
          setDetailsOpen(false);
          navigation.navigate('UserProfile', { userId: uid });
        }}
        onClose={() => setDetailsOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.cream,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 60, marginLeft: -4 },
  detailsBtn: { width: 60, alignItems: 'flex-end' },
  back: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  // flexShrink lets a long group name truncate with "…" instead of pushing
  // past the Back button.
  title: {
    flexShrink: 1,
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.cocoa,
    textAlign: 'center',
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginHorizontal: spacing.sm,
  },
  bubbleWrap: { marginBottom: spacing.md, maxWidth: '88%' },
  wrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderName: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.amberDark,
    marginBottom: 3,
    marginLeft: spacing.sm,
  },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  bubbleMine: { backgroundColor: colors.amber },
  bubbleBare: { backgroundColor: 'transparent', padding: 0 },
  bubbleTheirs: { backgroundColor: colors.white },
  text: { fontFamily: fonts.semi, fontSize: 15, lineHeight: 21, color: colors.cocoa },
  textMine: { color: colors.white },
  sharedCard: {
    width: SHARED_W,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  sharedAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sharedAuthorName: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 14.5,
    color: colors.cocoa,
  },
  sharedThumb: { width: SHARED_W, height: SHARED_W },
  profileCard: {
    width: 220,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  profileName: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.cocoa,
    marginTop: spacing.sm,
  },
  profileHandle: { fontFamily: fonts.semi, fontSize: 13, color: colors.cocoaFaint },
  profileBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.amber,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  profileBtnText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.white },
  sharedMeta: { paddingHorizontal: 12, paddingVertical: 11 },
  sharedBlurb: {
    fontFamily: fonts.semi,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.cocoa,
  },
  sharedTag: {
    fontFamily: fonts.bold,
    color: colors.amberDark,
  },
  row: { position: 'relative' },
  // Sits just off the right edge and slides in as the conversation moves left.
  swipeTime: {
    position: 'absolute',
    right: -spacing.lg,
    width: REVEAL_W,
    top: 0,
    bottom: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeTimeText: { fontFamily: fonts.semi, fontSize: 11.5, color: colors.cocoaFaint },
  dayDivider: {
    alignSelf: 'center',
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.cocoaFaint,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  reactions: { flexDirection: 'row', gap: 4, marginTop: -8, zIndex: 1 },
  reactionsMine: { marginRight: 8 },
  reactionsTheirs: { marginLeft: 8 },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1.5,
    borderColor: colors.cream,
  },
  reactionPillMine: { borderColor: colors.amber },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.cocoaSoft },
  reactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  reactionChoice: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionChoiceOn: { backgroundColor: colors.amberSoft },
  reactionChoiceEmoji: { fontSize: 26 },
  photo: {
    width: PHOTO_W,
    height: Math.round((PHOTO_W * 5) / 4),
    borderRadius: 10,
    backgroundColor: colors.creamDark,
  },
  attach: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
  },
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
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  input: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    maxHeight: 120,
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
