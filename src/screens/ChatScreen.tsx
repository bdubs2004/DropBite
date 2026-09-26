import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
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
import { PostThumb } from '../components/PostThumb';
import { Muted } from '../components/ui';
import { pickImage } from '../lib/pickImage';
import { relativeTime } from '../lib/time';
import { useKeyboardVisible } from '../lib/useKeyboardVisible';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';
import { Message } from '../types';

/** Bubble width for an attached photo, and the height of its 4:5 frame. */
const PHOTO_W = 190;

/** A shared-post card fills most of the bubble so it doesn't leave dead space. */
const SHARED_W = Math.min(300, Math.round(Dimensions.get('window').width * 0.72));

/** One DM thread. Messages can be text, a shared post, or both. */
export function ChatScreen({ navigation, route }: any) {
  const { conversationId, title } = route.params as {
    conversationId: string;
    title?: string;
  };
  const svc = getDataService();
  const { user } = useApp();
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();
  const listRef = useRef<FlatList<Message>>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // A photo staged in the composer, not sent yet — same "review before you
  // send" shape as compose, so a mis-tap costs nothing.
  const [photo, setPhoto] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Long-pressed message, for the report menu.
  const [menuFor, setMenuFor] = useState<Message | null>(null);

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
        <Text style={styles.title} numberOfLines={1}>
          {title ?? 'Chat'}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        ref={listRef}
        testID="chat-list"
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={pullRefresh}
            tintColor={colors.amber}
            colors={[colors.amber]}
          />
        }
        renderItem={({ item }) => {
          const mine = item.sender_id === user?.id;
          // A photo — or a shared-post card — on its own reads better as the
          // thing itself, not wrapped in a thick coloured frame.
          const photoOnly = !!item.image_url && !item.text && !item.shared_post_id;
          const sharedOnly = !!item.shared_post_id && !item.text && !item.image_url;
          const bare = photoOnly || sharedOnly;
          return (
            <Pressable
              testID={`chat-message-${item.id}`}
              // Reporting is the reason this is pressable; you can't report
              // your own message, so leave your own bubbles inert.
              onLongPress={() => !mine && setMenuFor(item)}
              delayLongPress={350}
              style={[styles.bubbleWrap, mine ? styles.wrapMine : styles.wrapTheirs]}
            >
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
                    {item.shared_post.blurb ? (
                      <View style={styles.sharedMeta}>
                        <Text style={styles.sharedBlurb} numberOfLines={2}>
                          {item.shared_post.blurb}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                ) : item.shared_post_id ? (
                  // The post existed when it was sent but has since been deleted.
                  <Muted style={{ fontStyle: 'italic' }}>This post is no longer available.</Muted>
                ) : null}

                {item.image_url ? (
                  <Image
                    testID={`chat-photo-${item.id}`}
                    source={{ uri: item.image_url }}
                    style={styles.photo}
                    resizeMode="cover"
                  />
                ) : null}

                {item.text ? (
                  <Text style={[styles.text, mine && styles.textMine]}>{item.text}</Text>
                ) : null}
              </View>
              <Muted style={styles.time}>{relativeTime(item.created_at)}</Muted>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
            No messages yet. Say something.
          </Muted>
        }
      />

      <ActionSheet
        visible={menuFor !== null}
        title="Message"
        onClose={() => setMenuFor(null)}
        actions={[
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
        ]}
      />

      {notice ? (
        <Pressable testID="chat-notice" onPress={() => setNotice(null)} style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
          <Ionicons name="close" size={16} color={colors.cocoaSoft} />
        </Pressable>
      ) : null}

      {photo ? (
        <View style={styles.staged}>
          <Image source={{ uri: photo }} style={styles.stagedThumb} resizeMode="cover" />
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
  back: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: { fontFamily: fonts.display, fontSize: 17, color: colors.cocoa, flex: 1, textAlign: 'center' },
  bubbleWrap: { marginBottom: spacing.md, maxWidth: '82%' },
  wrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
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
  sharedThumb: { width: SHARED_W, height: Math.round(SHARED_W * 0.9) },
  sharedMeta: { paddingHorizontal: 12, paddingVertical: 11 },
  sharedBlurb: {
    fontFamily: fonts.semi,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.cocoa,
  },
  time: { fontSize: 11, marginTop: 3 },
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
