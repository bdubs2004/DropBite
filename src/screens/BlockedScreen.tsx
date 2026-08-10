import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Button, Muted } from '../components/ui';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { User } from '../types';

/** Accounts you've blocked, with a way back out. */
export function BlockedScreen({ navigation }: any) {
  const svc = getDataService();
  const { refreshFeed } = useApp();
  const insets = useSafeAreaInsets();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setUsers(await svc.getBlockedUsers());
    setLoading(false);
  }, [svc]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const unblock = async (u: User) => {
    await svc.unblockUser(u.id);
    await load();
    refreshFeed();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Blocked</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          testID="blocked-list"
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          ListHeaderComponent={
            users.length ? (
              <Muted style={{ marginBottom: spacing.md }}>
                You and these accounts cannot see each other's posts or send messages.
              </Muted>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Avatar user={item} size={44} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.name}>{item.display_name}</Text>
                <Muted>@{item.handle}</Muted>
              </View>
              <Button
                testID={`unblock-${item.id}`}
                title="Unblock"
                variant="secondary"
                small
                onPress={() => unblock(item)}
              />
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="shield-checkmark-outline" size={40} color={colors.cocoaFaint} />
              <Muted style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
                You have not blocked anyone.
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
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 60, marginLeft: -4 },
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
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 80 },
});
