import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { PostThumb } from '../components/PostThumb';
import { Muted } from '../components/ui';
import { relativeTime } from '../lib/time';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, spacing } from '../theme';
import { Message } from '../types';

/** One DM thread. Messages can be text, a shared post, or both. */
export function ChatScreen({ navigation, route }: any) {
  const { conversationId, title } = route.params as {
    conversationId: string;
    title?: string;
  };
  const svc = getDataService();
  const { user } = useApp();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Message>>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setMessages(await svc.getMessages(conversationId));
    // Opening the thread is what clears its unread badge.
    await svc.markConversationRead(conversationId);
  }, [svc, conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await svc.sendMessage(conversationId, { text: body });
      setText('');
      await load();
      listRef.current?.scrollToEnd({ animated: true });
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
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
        renderItem={({ item }) => {
          const mine = item.sender_id === user?.id;
          return (
            <View style={[styles.bubbleWrap, mine ? styles.wrapMine : styles.wrapTheirs]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                {item.shared_post ? (
                  <Pressable
                    testID={`chat-shared-${item.id}`}
                    onPress={() =>
                      navigation.navigate('PostDetail', { postId: item.shared_post!.id })
                    }
                    style={styles.sharedCard}
                  >
                    <PostThumb post={item.shared_post} radius={10} style={{ width: 150 }} />
                    <Text style={styles.sharedBlurb} numberOfLines={2}>
                      {item.shared_post.blurb}
                    </Text>
                  </Pressable>
                ) : item.shared_post_id ? (
                  // The post existed when it was sent but has since been deleted.
                  <Muted style={{ fontStyle: 'italic' }}>This post is no longer available.</Muted>
                ) : null}

                {item.text ? (
                  <Text style={[styles.text, mine && styles.textMine]}>{item.text}</Text>
                ) : null}
              </View>
              <Muted style={styles.time}>{relativeTime(item.created_at)}</Muted>
            </View>
          );
        }}
        ListEmptyComponent={
          <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
            No messages yet. Say something.
          </Muted>
        }
      />

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
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
          disabled={!text.trim() || sending}
          style={[styles.send, (!text.trim() || sending) && { opacity: 0.4 }]}
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
  bubbleTheirs: { backgroundColor: colors.white },
  text: { fontFamily: fonts.semi, fontSize: 15, lineHeight: 21, color: colors.cocoa },
  textMine: { color: colors.white },
  sharedCard: { gap: 6 },
  sharedBlurb: {
    fontFamily: fonts.semi,
    fontSize: 12.5,
    color: colors.cocoaSoft,
    width: 150,
  },
  time: { fontSize: 11, marginTop: 3 },
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
