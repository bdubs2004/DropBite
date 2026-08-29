import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Muted } from '../components/ui';
import { getDataService } from '../services';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { User } from '../types';

/**
 * Followers / following list for a user. If the target user's lists are
 * private (and it isn't you), the screen still opens but shows a private
 * notice instead of the names.
 */
export function UserListScreen({ navigation, route }: any) {
  const { userId, mode, displayName, isPrivate, isMe } = route.params as {
    userId: string;
    mode: 'followers' | 'following';
    displayName: string;
    isPrivate: boolean;
    isMe: boolean;
  };
  const svc = getDataService();
  const insets = useSafeAreaInsets();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const gated = isPrivate && !isMe;
  const title = mode === 'followers' ? 'Followers' : 'Following';

  const load = useCallback(async () => {
    if (gated) {
      setLoading(false);
      return;
    }
    const list =
      mode === 'followers'
        ? await svc.getFollowers(userId)
        : await svc.getFollowingUsers(userId);
    setUsers(list);
    setLoading(false);
  }, [svc, userId, mode, gated]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
        </Pressable>
        <View>
          <Text style={styles.title}>{title}</Text>
          <Muted>{isMe ? 'You' : displayName}</Muted>
        </View>
        <View style={{ width: 30 }} />
      </View>

      {gated ? (
        <View style={styles.gate}>
          <Ionicons name="lock-closed-outline" size={44} color={colors.cocoaFaint} />
          <Text style={styles.privateTitle}>{title} are private</Text>
          <Muted style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
            {displayName} keeps their {title.toLowerCase()} list private.
          </Muted>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.push('UserProfile', { userId: item.id })}
            >
              <Avatar user={item} size={46} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.name}>{item.display_name}</Text>
                <Muted>@{item.handle}</Muted>
                {item.bio ? (
                  <Text style={styles.bio} numberOfLines={1}>
                    {item.bio}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.cocoaFaint} />
            </Pressable>
          )}
          ListEmptyComponent={
            loading ? null : (
              // Give the empty case the same weight as the private one: an
              // icon, a headline, and a line telling you what to do next.
              <View style={styles.empty}>
                <Ionicons
                  name={mode === 'followers' ? 'people-outline' : 'person-add-outline'}
                  size={44}
                  color={colors.cocoaFaint}
                />
                <Text style={styles.emptyTitle}>
                  {mode === 'followers'
                    ? isMe
                      ? 'No followers yet'
                      : 'No followers yet'
                    : isMe
                      ? "You're not following anyone"
                      : 'Not following anyone'}
                </Text>
                <Muted style={styles.emptyBody}>
                  {mode === 'followers'
                    ? isMe
                      ? 'Share a meal or two and people will start following you.'
                      : `When someone follows ${displayName}, they'll show up here.`
                    : isMe
                      ? 'Find people in Discover and their meals will fill your feed.'
                      : `${displayName} hasn't followed anyone yet.`}
                </Muted>
                {isMe ? (
                  <Pressable
                    testID="empty-discover"
                    style={styles.emptyCta}
                    onPress={() => navigation.navigate('Tabs', { screen: 'Discover' })}
                  >
                    <Ionicons name="compass-outline" size={17} color={colors.white} />
                    <Text style={styles.emptyCtaText}>Find people</Text>
                  </Pressable>
                ) : null}
              </View>
            )
          }
        />
      )}
    </View>
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
    width: 30,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cocoa,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...(shadowSoft as object),
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
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: 80,
    paddingHorizontal: spacing.xl,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: 70,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.cocoa,
    textAlign: 'center',
  },
  emptyBody: {
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.amber,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    marginTop: spacing.sm,
  },
  emptyCtaText: {
    fontFamily: fonts.bold,
    fontSize: 14.5,
    color: colors.white,
  },
  privateTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.cocoa,
  },
});
