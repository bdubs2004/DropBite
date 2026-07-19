import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { PostCard } from '../components/PostCard';
import { Input, Muted, ScreenTitle } from '../components/ui';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { Post, User } from '../types';

/**
 * Search across people and posts in your feed (people match handle or name;
 * posts match description, recipe title, or tagged restaurant).
 */
export function SearchScreen({ navigation }: any) {
  const svc = getDataService();
  const { feed, refreshFeed } = useApp();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);

  const q = query.trim().toLowerCase();

  const load = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setUsers([]);
        return;
      }
      setUsers(await svc.listUsers(text));
    },
    [svc],
  );

  useEffect(() => {
    load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const posts: Post[] = q
    ? feed.filter(
        (p) =>
          p.blurb.toLowerCase().includes(q) ||
          (p.recipe?.title ?? '').toLowerCase().includes(q) ||
          (p.restaurant_name ?? '').toLowerCase().includes(q),
      )
    : [];

  const toggleLike = async (post: Post) => {
    await svc.toggleReaction(post.id);
    refreshFeed();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScreenTitle>Search</ScreenTitle>
        <Muted>Find people, dishes, and restaurants.</Muted>
      </View>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Input placeholder="Search DropBite" value={query} onChangeText={setQuery} />
      </View>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={
          users.length ? (
            <View style={{ padding: spacing.lg, paddingTop: 0 }}>
              <Text style={styles.section}>People</Text>
              {users.map((u) => (
                <Pressable
                  key={u.id}
                  style={styles.userRow}
                  onPress={() => navigation.navigate('UserProfile', { userId: u.id })}
                >
                  <Avatar user={u} size={44} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.name}>{u.display_name}</Text>
                    <Muted>@{u.handle}</Muted>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.cocoaFaint} />
                </Pressable>
              ))}
              {posts.length ? <Text style={styles.section}>Posts</Text> : null}
            </View>
          ) : null
        }
        renderItem={({ item }) => <PostCard post={item} onToggleLike={toggleLike} />}
        ListEmptyComponent={
          !q ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={40} color={colors.cocoaFaint} />
              <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>
                Type to search people you can follow and posts in your feed.
              </Muted>
            </View>
          ) : users.length ? null : (
            <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
              No matches found.
            </Muted>
          )
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
  section: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  userRow: {
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
    fontSize: 15,
    color: colors.cocoa,
  },
  empty: {
    alignItems: 'center',
    padding: spacing.xxl,
    marginTop: 40,
  },
});
