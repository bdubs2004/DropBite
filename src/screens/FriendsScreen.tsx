import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Button, Input, Muted, ScreenTitle } from '../components/ui';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { User } from '../types';

export function FriendsScreen({ navigation }: any) {
  const svc = getDataService();
  const { refreshFeed } = useApp();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (q?: string) => {
      const [list, ids] = await Promise.all([svc.listUsers(q), svc.getFollowingIds()]);
      setUsers(list);
      setFollowingIds(new Set(ids));
    },
    [svc],
  );

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (u: User) => {
    if (followingIds.has(u.id)) await svc.unfollow(u.id);
    else await svc.follow(u.id);
    await load(query);
    refreshFeed();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScreenTitle>Discover</ScreenTitle>
        <Muted>Follow people to fill your feed.</Muted>
      </View>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Input
          placeholder="Search by name or handle…"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            load(t);
          }}
        />
      </View>
      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: 120 }}
        renderItem={({ item }) => {
          const isFollowing = followingIds.has(item.id);
          return (
            <View style={styles.row}>
              <Pressable
                style={styles.userTap}
                onPress={() => navigation.navigate('UserProfile', { userId: item.id })}
              >
                <Avatar user={item} size={48} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.name}>{item.display_name}</Text>
                  <Muted>@{item.handle}</Muted>
                  {item.bio ? (
                    <Text style={styles.bio} numberOfLines={1}>
                      {item.bio}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              <Button
                title={isFollowing ? 'Following' : 'Follow'}
                variant={isFollowing ? 'secondary' : 'primary'}
                onPress={() => toggle(item)}
                small
              />
            </View>
          );
        }}
        ListEmptyComponent={
          <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
            No one found. Invite your friends to join.
          </Muted>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...(shadowSoft as object),
  },
  userTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 15.5,
    color: colors.cocoa,
  },
  bio: {
    fontFamily: fonts.semi,
    fontSize: 12.5,
    color: colors.cocoaFaint,
    marginTop: 2,
  },
});
