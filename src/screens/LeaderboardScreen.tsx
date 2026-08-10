import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Muted } from '../components/ui';
import { getDataService } from '../services';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { LeaderboardEntry, LeaderboardScope } from '../types';

/** Medal tints for the top three; everyone else gets a plain number. */
const MEDALS: Record<number, string> = {
  1: '#D8A02B',
  2: '#A9A9A9',
  3: '#B87333',
};

export function LeaderboardScreen({ navigation }: any) {
  const svc = getDataService();
  const insets = useSafeAreaInsets();

  const [scope, setScope] = useState<LeaderboardScope>('friends');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setEntries(await svc.getLeaderboard(scope));
    setLoading(false);
  }, [svc, scope]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const me = entries.find((e) => e.is_me);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Streaks</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Your own standing, always visible even if you're far down the list. */}
      {me ? (
        <View style={styles.mePill}>
          <Ionicons name="flame" size={18} color={colors.amber} />
          <Text style={styles.meText}>
            {me.current_streak > 0
              ? `You're #${me.rank} with a ${me.current_streak}-day streak`
              : 'No streak yet. Post a meal today to start one.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.tabs}>
        <TabButton
          label="Friends"
          active={scope === 'friends'}
          onPress={() => setScope('friends')}
        />
        <TabButton
          label="Everyone"
          active={scope === 'everyone'}
          onPress={() => setScope('everyone')}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          testID="leaderboard-list"
          data={entries}
          keyExtractor={(e) => e.user.id}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.amber} />
          }
          renderItem={({ item }) => (
            <Row
              entry={item}
              onPress={() =>
                item.is_me
                  ? navigation.navigate('Tabs', { screen: 'Profile' })
                  : navigation.navigate('UserProfile', { userId: item.user.id })
              }
            />
          )}
          ListEmptyComponent={
            <Muted style={styles.empty}>
              {scope === 'friends'
                ? 'Follow some people and their streaks show up here.'
                : 'No streaks yet. Be the first.'}
            </Muted>
          }
        />
      )}
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`leaderboard-tab-${label.toLowerCase()}`}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Row({ entry, onPress }: { entry: LeaderboardEntry; onPress: () => void }) {
  const { user, current_streak, longest_streak, rank, is_me } = entry;
  const medal = current_streak > 0 ? MEDALS[rank] : undefined;

  return (
    <Pressable
      testID={`leaderboard-row-${user.id}`}
      onPress={onPress}
      style={[styles.row, is_me && styles.rowMe]}
    >
      <View style={styles.rankWrap}>
        {medal ? (
          <Ionicons name="medal" size={22} color={medal} />
        ) : (
          <Text style={styles.rankText}>{rank}</Text>
        )}
      </View>
      <Avatar user={user} size={42} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={styles.name} numberOfLines={1}>
          {user.display_name}
          {is_me ? <Text style={styles.youTag}>  you</Text> : null}
        </Text>
        <Muted>@{user.handle}</Muted>
      </View>
      <View style={styles.streakWrap}>
        <View style={styles.streakRow}>
          <Ionicons
            name="flame"
            size={16}
            color={current_streak > 0 ? colors.amber : colors.cocoaFaint}
          />
          <Text style={[styles.streakNum, current_streak === 0 && { color: colors.cocoaFaint }]}>
            {current_streak}
          </Text>
        </View>
        <Text style={styles.best}>best {longest_streak}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.cream,
  },
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
  back: {
    fontFamily: fonts.bold,
    color: colors.amberDark,
    fontSize: 15,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cocoa,
  },
  mePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...(shadowSoft as object),
  },
  meText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 14.5,
    color: colors.cocoa,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.creamDark,
    borderRadius: radius.pill,
    padding: 4,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.white,
    ...(shadowSoft as object),
  },
  tabText: {
    fontFamily: fonts.bold,
    fontSize: 14.5,
    color: colors.cocoaSoft,
  },
  tabTextActive: {
    color: colors.amberDark,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1.5,
    borderColor: 'transparent',
    ...(shadowSoft as object),
  },
  rowMe: {
    borderColor: colors.amber,
    backgroundColor: colors.cream,
  },
  rankWrap: {
    width: 30,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  rankText: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.cocoaFaint,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 15.5,
    color: colors.cocoa,
  },
  youTag: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.amberDark,
  },
  streakWrap: {
    alignItems: 'flex-end',
    marginLeft: spacing.sm,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  streakNum: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cocoa,
  },
  best: {
    fontFamily: fonts.semi,
    fontSize: 11.5,
    color: colors.cocoaFaint,
    marginTop: 1,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
});
