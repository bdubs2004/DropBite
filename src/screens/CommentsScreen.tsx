import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
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
import { Avatar } from '../components/Avatar';
import { Muted } from '../components/ui';
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

  const load = useCallback(async () => {
    setComments(await svc.getComments(postId));
    setLoading(false);
  }, [svc, postId]);

  useEffect(() => {
    load();
  }, [load]);

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
          <View style={styles.row}>
            <Avatar user={item.user} size={38} />
            <View style={styles.bubble}>
              <Text style={styles.name}>
                {item.user?.display_name ?? 'Someone'}{' '}
                <Text style={styles.handle}>@{item.user?.handle ?? 'unknown'}</Text>
              </Text>
              <Text style={styles.text}>{item.text}</Text>
              <Text style={styles.time}>{relativeTime(item.created_at)}</Text>
            </View>
          </View>
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

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Avatar user={user} size={34} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Add a comment"
          placeholderTextColor={colors.cocoaFaint}
          style={styles.input}
          multiline
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
    marginBottom: spacing.lg,
  },
  bubble: {
    flex: 1,
    marginLeft: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.cocoa,
  },
  handle: {
    fontFamily: fonts.semi,
    fontSize: 12.5,
    color: colors.cocoaFaint,
  },
  text: {
    fontFamily: fonts.semi,
    fontSize: 15,
    lineHeight: 21,
    color: colors.cocoa,
    marginTop: 3,
  },
  time: {
    fontFamily: fonts.semi,
    fontSize: 11.5,
    color: colors.cocoaFaint,
    marginTop: 5,
  },
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
