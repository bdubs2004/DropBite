import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Button, Muted } from '../components/ui';
import { conversationTitle } from '../lib/conversationName';
import { getDataService } from '../services';
import { colors, fonts, radius, spacing } from '../theme';
import { User } from '../types';

/**
 * Pick who to message. Choose one person for a DM, or several for a group chat.
 *
 * Only people you follow are listed: DMs are opt-in, so a stranger cannot open
 * a thread with you. RLS enforces the same rule ("join conversations" in
 * schema.sql) — this list just means you never see a name you can't message.
 */
export function NewMessageScreen({ navigation }: any) {
  const svc = getDataService();
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<User[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const me = await svc.getCurrentUser();
    setPeople(me ? await svc.getFollowingUsers(me.id) : []);
    setLoading(false);
  }, [svc]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isGroup = selected.size >= 2;

  const start = async () => {
    if (selected.size === 0 || starting) return;
    const ids = [...selected];
    setStarting(true);
    try {
      if (isGroup) {
        const id = await svc.startGroupConversation(ids);
        const chosen = people.filter((p) => selected.has(p.id));
        // replace, so Back from the thread returns to the inbox, not here.
        navigation.replace('Chat', {
          conversationId: id,
          title: conversationTitle(chosen),
          isGroup: true,
          fallbackTitle: conversationTitle(chosen),
        });
      } else {
        const target = people.find((p) => p.id === ids[0]);
        const id = await svc.startConversation(ids[0]);
        navigation.replace('Chat', {
          conversationId: id,
          title: target?.display_name ?? 'Chat',
          isGroup: false,
        });
      }
    } catch (e: any) {
      // Reachable if they unfollowed on another device between this list
      // loading and the tap.
      setError(e?.message ?? 'Could not start that conversation.');
    } finally {
      setStarting(false);
    }
  };

  return (
    // A full-screen page (see SLIDE_UP in App.tsx), so it clears the status bar.
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
        <>
          <FlatList
            data={people}
            keyExtractor={(u) => u.id}
            contentContainerStyle={{ padding: spacing.lg }}
            ListHeaderComponent={
              people.length > 0 ? (
                <Muted style={{ marginBottom: spacing.sm }}>
                  Pick one person for a DM, or several for a group chat.
                </Muted>
              ) : null
            }
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return (
                <Pressable
                  testID={`new-message-${item.id}`}
                  style={[styles.row, on && styles.rowOn]}
                  onPress={() => toggle(item.id)}
                >
                  <Avatar user={item} size={44} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.name}>{item.display_name}</Text>
                    <Muted>@{item.handle}</Muted>
                  </View>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? colors.amberDark : colors.cocoaFaint}
                  />
                </Pressable>
              );
            }}
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

          {selected.size > 0 ? (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
              <Button
                testID="new-message-start"
                title={
                  starting
                    ? 'Starting'
                    : isGroup
                      ? `Create group chat (${selected.size})`
                      : 'Start message'
                }
                onPress={start}
                disabled={starting}
                loading={starting}
              />
            </View>
          ) : null}
        </>
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
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
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  rowOn: { borderColor: colors.amber },
  name: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 60, paddingHorizontal: spacing.xl },
  emptyTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.cocoa },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.white,
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
});
