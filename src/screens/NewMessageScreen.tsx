import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Muted } from '../components/ui';
import { getDataService } from '../services';
import { colors, fonts, radius, spacing } from '../theme';
import { User } from '../types';

/**
 * Pick someone to start a DM thread with.
 *
 * Only people you follow are listed: DMs are opt-in, so a stranger cannot
 * open a thread with you. RLS enforces the same rule ("join conversations" in
 * schema.sql) — this list just means you never see a name you can't message.
 */
export function NewMessageScreen({ navigation }: any) {
  const svc = getDataService();
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const me = await svc.getCurrentUser();
    setPeople(me ? await svc.getFollowingUsers(me.id) : []);
    setLoading(false);
  }, [svc]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (u: User) => {
    try {
      const id = await svc.startConversation(u.id);
      // replace, so Back from the thread returns to the inbox, not here.
      navigation.replace('Chat', { conversationId: id, title: u.display_name });
    } catch (e: any) {
      // Reachable if they unfollowed on another device between this list
      // loading and the tap.
      setError(e?.message ?? 'Could not open that conversation.');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>New message</Text>
        <View style={{ width: 56 }} />
      </View>
      {error ? (
        <Pressable testID="new-message-error" onPress={() => setError(null)} style={styles.notice}>
          <Text style={styles.noticeText}>{error}</Text>
          <Ionicons name="close" size={16} color={colors.cocoaSoft} />
        </Pressable>
      ) : null}
      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <Pressable testID={`new-message-${item.id}`} style={styles.row} onPress={() => open(item)}>
              <Avatar user={item} size={44} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.name}>{item.display_name}</Text>
                <Muted>@{item.handle}</Muted>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.cocoaFaint} />
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={38} color={colors.cocoaFaint} />
              <Text style={styles.emptyTitle}>Follow someone first</Text>
              <Muted style={{ textAlign: 'center' }}>
                You can message anyone you follow. Find people on Discover or Search.
              </Muted>
            </View>
          }
        />
      )}
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
  cancel: { fontFamily: fonts.bold, color: colors.cocoaSoft, fontSize: 15, width: 56 },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  name: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 60, paddingHorizontal: spacing.xl },
  emptyTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.cocoa },
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
});
