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
import {
  addRecentSearch,
  addRecentTerm,
  clearRecentSearches,
  clearRecentTerms,
  getRecentSearches,
  getRecentTerms,
  removeRecentSearch,
  removeRecentTerm,
} from '../lib/recentSearches';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
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
  const { hiddenIds } = useApp();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('dishes');
  // Two fully independent searches: each tab keeps its own query and its own
  // results, and only the active tab's source is queried. Typing in one never
  // touches the other, so there is zero overlap between people and dishes.
  const [dishQuery, setDishQuery] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [people, setPeople] = useState<User[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState<Awaited<ReturnType<typeof getRecentSearches>>>([]);
  const [recentTerms, setRecentTerms] = useState<string[]>([]);

  const query = tab === 'dishes' ? dishQuery : peopleQuery;
  const setQuery = (t: string) => (tab === 'dishes' ? setDishQuery(t) : setPeopleQuery(t));

  // Recents are what the screen shows before you have typed anything: opened
  // profiles on the People tab, searched dish terms on the Dishes tab.
  const loadRecents = useCallback(async () => {
    const [users, terms] = await Promise.all([getRecentSearches(), getRecentTerms()]);
    setRecents(users);
    setRecentTerms(terms);
  }, []);

  useEffect(() => {
    loadRecents();
  }, [loadRecents]);

  const openProfile = async (u: { id: string } & Record<string, any>) => {
    await addRecentSearch(u as any);
    loadRecents();
    navigation.navigate('UserProfile', { userId: u.id });
  };

  // Tapping into a dish result remembers what you searched, so next time the
  // Dishes tab can offer it back as a recent search.
  const openPost = async (postId: string) => {
    await addRecentTerm(dishQuery);
    loadRecents();
    navigation.navigate('PostDetail', { postId });
  };
  // Guards against a slow early request landing after a later one.
  const seq = useRef(0);

  // Search only the active tab's source — never both. Dishes never returns
  // people, people never returns dishes.
  const run = useCallback(
    async (which: Tab, text: string) => {
      const term = text.trim();
      const mine = ++seq.current;
      if (!term) {
        if (which === 'dishes') setPosts([]);
        else setPeople([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        if (which === 'dishes') {
          const p = await svc.searchPosts(term);
          if (mine !== seq.current) return;
          setPosts(p);
        } else {
          const u = await svc.listUsers(term);
          if (mine !== seq.current) return;
          setPeople(u);
        }
      } catch {
        if (mine !== seq.current) return;
        if (which === 'dishes') setPosts([]);
        else setPeople([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    },
    [svc],
  );

  // Debounce so typing doesn't fire a query per keystroke. Re-runs on tab
  // switch too, so each tab shows results for its own query.
  useEffect(() => {
    const t = setTimeout(() => run(tab, query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [tab, query, run]);

  const gridData: (Post | null)[] = (() => {
    const visible = posts.filter((p) => !hiddenIds.has(p.id));
    const remainder = visible.length % GRID_COLUMNS;
    if (remainder === 0) return visible;
    return [...visible, ...Array(GRID_COLUMNS - remainder).fill(null)];
  })();

  const hasQuery = query.trim().length > 0;
  const count = tab === 'dishes' ? posts.length : people.length;

  const header = (
    <View style={styles.header}>
      <ScreenTitle>Search</ScreenTitle>
      <Muted>Find people and dishes</Muted>
      <View style={{ marginTop: spacing.md }}>
        <View>
          <Input
            testID="search-input"
            placeholder={
              tab === 'dishes'
                ? 'Search dishes and ingredients'
                : 'Search people by name or handle'
            }
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ paddingRight: 42 }}
          />
          {query.length > 0 ? (
            <Pressable
              testID="search-clear"
              onPress={() => setQuery('')}
              hitSlop={10}
              style={styles.clearBtn}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={19} color={colors.cocoaFaint} />
            </Pressable>
          ) : null}
        </View>
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
    // Dishes tab: offer back the terms you searched before.
    tab === 'dishes' && recentTerms.length > 0 ? (
      <View testID="search-recent-terms" style={styles.recents}>
        <View style={styles.recentsHead}>
          <Text style={styles.recentsTitle}>Recent searches</Text>
          <Pressable
            testID="recent-terms-clear-all"
            onPress={async () => {
              await clearRecentTerms();
              loadRecents();
            }}
            hitSlop={8}
          >
            <Text style={styles.recentsClear}>Clear all</Text>
          </Pressable>
        </View>
        {recentTerms.map((term) => (
          <Pressable
            key={term}
            testID={`recent-term-${term}`}
            style={styles.termRow}
            onPress={() => setDishQuery(term)}
          >
            <Ionicons name="search" size={17} color={colors.cocoaFaint} />
            <Text style={styles.termText} numberOfLines={1}>
              {term}
            </Text>
            <Pressable
              testID={`recent-term-remove-${term}`}
              onPress={async () => {
                await removeRecentTerm(term);
                loadRecents();
              }}
              hitSlop={10}
            >
              <Ionicons name="close" size={17} color={colors.cocoaFaint} />
            </Pressable>
          </Pressable>
        ))}
      </View>
    ) : // Profile recents are people you looked up, so they belong on the People tab.
    tab === 'people' && recents.length > 0 ? (
      <View testID="search-recents" style={styles.recents}>
        <View style={styles.recentsHead}>
          <Text style={styles.recentsTitle}>Recent</Text>
          <Pressable
            testID="recents-clear-all"
            onPress={async () => {
              await clearRecentSearches();
              loadRecents();
            }}
            hitSlop={8}
          >
            <Text style={styles.recentsClear}>Clear all</Text>
          </Pressable>
        </View>
        {recents.map((u) => (
          <Pressable
            key={u.id}
            testID={`recent-${u.id}`}
            style={styles.userRow}
            onPress={() => openProfile(u)}
          >
            <Avatar user={u as any} size={40} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.name}>{u.display_name}</Text>
              <Muted>@{u.handle}</Muted>
            </View>
            <Pressable
              testID={`recent-remove-${u.id}`}
              onPress={async () => {
                await removeRecentSearch(u.id);
                loadRecents();
              }}
              hitSlop={10}
            >
              <Ionicons name="close" size={17} color={colors.cocoaFaint} />
            </Pressable>
          </Pressable>
        ))}
      </View>
    ) : (
      <View style={styles.empty}>
        <Ionicons name={tab === 'dishes' ? 'restaurant-outline' : 'people-outline'} size={40} color={colors.cocoaFaint} />
        <Muted style={styles.emptyText}>
          {tab === 'dishes'
            ? 'Search for a dish or an ingredient, like chicken, pancakes, or gochujang'
            : 'Search for someone by name or handle'}
        </Muted>
      </View>
    )
  ) : searching ? (
    <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
  ) : (
    <View style={styles.empty}>
      <Muted style={styles.emptyText}>
        Nothing matched “{query.trim()}”. Try a different word
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
                onPress={() => openPost(item.id)}
                onLongPress={() => {
                  addRecentTerm(dishQuery).then(loadRecents);
                  navigation.navigate('PostPeek', { postId: item.id });
                }}
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
          // No horizontal padding here: the header carries its own, and adding
          // it on the container too would double-pad the header, so the search
          // bar and tabs would jump inward versus the Dishes tab. The rows get
          // their own side margin instead.
          contentContainerStyle={{ paddingBottom: 120 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`search-person-${item.id}`}
              style={[styles.userRow, styles.userRowInList]}
              onPress={() => openProfile(item)}
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
  userRowInList: { marginHorizontal: spacing.lg },
  termRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    ...(shadowSoft as object),
  },
  termText: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  name: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  bio: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 2 },
  clearBtn: {
    position: 'absolute',
    right: 12,
    top: 14,
  },
  recents: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  recentsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  recentsTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  recentsClear: { fontFamily: fonts.bold, fontSize: 13, color: colors.amberDark },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 60 },
  emptyText: { textAlign: 'center', paddingHorizontal: spacing.xl },
});
