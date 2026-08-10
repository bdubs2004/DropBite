import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { PostThumb } from '../components/PostThumb';
import { Input, Muted, ScreenTitle } from '../components/ui';
import { getDataService } from '../services';
import { colors, fonts, radius, shadowSoft, spacing } from '../theme';
import { Post, User } from '../types';

type Tab = 'dishes' | 'people';

const GRID_COLUMNS = 3;
const GRID_GAP = 2;
const DEBOUNCE_MS = 250;

/**
 * Search people and dishes across the whole app.
 *
 * Dishes match on the description, the recipe title, or an ingredient — the
 * structured ingredient data is what makes "chicken" or "gochujang" find
 * things the caption never mentioned.
 */
export function SearchScreen({ navigation }: any) {
  const svc = getDataService();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('dishes');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<User[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [searching, setSearching] = useState(false);
  // Guards against a slow early request landing after a later one.
  const seq = useRef(0);

  const run = useCallback(
    async (text: string) => {
      const term = text.trim();
      const mine = ++seq.current;
      if (!term) {
        setPeople([]);
        setPosts([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      const [u, p] = await Promise.all([svc.listUsers(term), svc.searchPosts(term)]);
      if (mine !== seq.current) return; // a newer search already answered
      setPeople(u);
      setPosts(p);
      setSearching(false);
    },
    [svc],
  );

  // Debounce so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => run(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, run]);

  const gridData: (Post | null)[] = (() => {
    const remainder = posts.length % GRID_COLUMNS;
    if (remainder === 0) return posts;
    return [...posts, ...Array(GRID_COLUMNS - remainder).fill(null)];
  })();

  const hasQuery = query.trim().length > 0;
  const count = tab === 'dishes' ? posts.length : people.length;

  const header = (
    <View style={styles.header}>
      <ScreenTitle>Search</ScreenTitle>
      <Muted>Find people and dishes.</Muted>
      <View style={{ marginTop: spacing.md }}>
        <Input
          testID="search-input"
          placeholder="Try chicken, pancakes, or a name"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <View style={styles.tabs}>
        <TabButton label="Dishes" active={tab === 'dishes'} onPress={() => setTab('dishes')} />
        <TabButton label="People" active={tab === 'people'} onPress={() => setTab('people')} />
      </View>
      {hasQuery && !searching ? (
        <Muted style={{ marginTop: spacing.sm }}>
          {count} {tab === 'dishes' ? 'dish' : 'person'}
          {count === 1 ? '' : tab === 'dishes' ? 'es' : 's'} found
        </Muted>
      ) : null}
    </View>
  );

  const empty = !hasQuery ? (
    <View style={styles.empty}>
      <Ionicons name="search" size={40} color={colors.cocoaFaint} />
      <Muted style={styles.emptyText}>
        Search for a dish, an ingredient, or someone by name or handle.
      </Muted>
    </View>
  ) : searching ? (
    <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
  ) : (
    <View style={styles.empty}>
      <Muted style={styles.emptyText}>
        Nothing matched “{query.trim()}”. Try a different word.
      </Muted>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {tab === 'dishes' ? (
        <FlatList
          testID="search-dishes"
          key="dishes"
          data={gridData}
          keyExtractor={(p, i) => p?.id ?? `spacer-${i}`}
          numColumns={GRID_COLUMNS}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 120 }}
          renderItem={({ item }) =>
            item ? (
              <PostThumb
                post={item}
                onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
                style={{ flex: 1 }}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )
          }
          ListEmptyComponent={empty}
        />
      ) : (
        <FlatList
          testID="search-people"
          key="people"
          data={people}
          keyExtractor={(u) => u.id}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`search-person-${item.id}`}
              style={styles.userRow}
              onPress={() => navigation.navigate('UserProfile', { userId: item.id })}
            >
              <Avatar user={item} size={44} />
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
          ListEmptyComponent={empty}
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
      testID={`search-tab-${label.toLowerCase()}`}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.creamDark,
    borderRadius: radius.pill,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center' },
  tabActive: { backgroundColor: colors.white, ...(shadowSoft as object) },
  tabText: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.cocoaSoft },
  tabTextActive: { color: colors.amberDark },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...(shadowSoft as object),
  },
  name: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  bio: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 2 },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 60 },
  emptyText: { textAlign: 'center', paddingHorizontal: spacing.xl },
});
