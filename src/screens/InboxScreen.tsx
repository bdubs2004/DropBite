import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionSheet } from '../components/ActionSheet';
import { Avatar } from '../components/Avatar';
import { Muted } from '../components/ui';
import { relativeTime } from '../lib/time';
import { getDataService } from '../services';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { Conversation } from '../types';

/** Your DM threads, most recently active first. */
export function InboxScreen({ navigation }: any) {
  const svc = getDataService();
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<Conversation | null>(null);
  const [confirming, setConfirming] = useState<Conversation | null>(null);

  const load = useCallback(async () => {
    setConversations(await svc.getConversations());
    setLoading(false);
  }, [svc]);

  const pullRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  // Reload on focus so unread counts settle after reading a thread.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const removeConversation = async (c: Conversation) => {
    setConversations((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await svc.deleteConversation(c.id);
    } catch {
      load(); // restore if the write failed
    }
  };

  const askDelete = (c: Conversation) => {
    if (Platform.OS === 'web') {
      setConfirming(c);
      return;
    }
    Alert.alert(
      `Delete conversation with ${c.other.display_name}?`,
      'It disappears from your inbox. They keep their copy of the thread.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeConversation(c) },
      ],
    );
  };

  const preview = (c: Conversation) => {
    if (!c.last_message) return 'Say hello';
    if (c.last_message.shared_post_id && !c.last_message.text) return 'Shared a post';
    return c.last_message.text;
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Messages</Text>
        <Pressable
          testID="inbox-new"
          onPress={() => navigation.navigate('NewMessage')}
          hitSlop={10}
          style={{ width: 60, alignItems: 'flex-end' }}
        >
          <Ionicons name="create-outline" size={22} color={colors.amberDark} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          testID="inbox-list"
          data={conversations}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullRefresh}
              tintColor={colors.amber}
              colors={[colors.amber]}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`conversation-${item.other.id}`}
              style={styles.row}
              onLongPress={() => setMenuFor(item)}
              delayLongPress={350}
              onPress={() =>
                navigation.navigate('Chat', {
                  conversationId: item.id,
                  title: item.other.display_name,
                })
              }
            >
              <Avatar user={item.other} size={48} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.name}>{item.other.display_name}</Text>
                <Text
                  style={[styles.preview, item.unread_count > 0 && styles.previewUnread]}
                  numberOfLines={1}
                >
                  {preview(item)}
                </Text>
              </View>
              <View style={styles.rightCol}>
                {item.last_message ? (
                  <Muted style={{ fontSize: 11.5 }}>
                    {relativeTime(item.last_message.created_at)}
                  </Muted>
                ) : null}
                {item.unread_count > 0 ? (
                  <View testID={`unread-${item.other.id}`} style={styles.badge}>
                    <Text style={styles.badgeText}>{item.unread_count}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="paper-plane-outline" size={40} color={colors.cocoaFaint} />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Muted style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
                Send a post to a friend, or start a conversation from the pencil above.
              </Muted>
            </View>
          }
        />
      )}

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? menuFor.other.display_name : undefined}
        onClose={() => setMenuFor(null)}
        actions={[
          {
            key: 'delete-conversation',
            label: 'Delete conversation',
            hint: 'Removes it from your inbox only',
            icon: 'trash-outline',
            destructive: true,
            onPress: () => menuFor && askDelete(menuFor),
          },
        ]}
      />

      {confirming ? (
        <View style={styles.confirmBar}>
          <Text style={styles.confirmText}>
            Delete this conversation? It leaves your inbox; they keep theirs.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              testID="conversation-delete-cancel"
              onPress={() => setConfirming(null)}
              style={[styles.confirmBtn, styles.confirmCancel]}
            >
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="conversation-delete-confirm"
              onPress={() => {
                const t = confirming;
                setConfirming(null);
                if (t) removeConversation(t);
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
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    width: 60,
    marginLeft: -4,
  },
  back: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...(shadowSoft as object),
  },
  name: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  preview: {
    fontFamily: fonts.semi,
    fontSize: 13.5,
    color: colors.cocoaFaint,
    marginTop: 2,
  },
  previewUnread: { fontFamily: fonts.bold, color: colors.cocoa },
  rightCol: { alignItems: 'flex-end', gap: 6, marginLeft: spacing.sm },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  confirmBar: {
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderColor: colors.creamDark,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  confirmText: { fontFamily: fonts.semi, fontSize: 13.5, lineHeight: 19, color: colors.cocoa },
  confirmBtn: { borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  confirmCancel: { backgroundColor: colors.creamDark },
  confirmCancelText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.cocoa },
  confirmDelete: { backgroundColor: colors.danger },
  confirmDeleteText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.white },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 80 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.cocoa },
});
