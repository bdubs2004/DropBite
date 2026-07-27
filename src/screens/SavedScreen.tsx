import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostCard } from '../components/PostCard';
import { Muted } from '../components/ui';
import { usePostActions } from '../lib/usePostActions';
import { getDataService } from '../services';
import { colors, fonts, spacing } from '../theme';
import { Post } from '../types';

/** The user's saved (bookmarked) posts. Private to them. */
export function SavedScreen({ navigation }: any) {
  const svc = getDataService();
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setPosts(await svc.getSavedPosts());
    setLoading(false);
  }, [svc]);

  // Refresh on focus so un-saving from another screen (or here) stays in sync.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const { like, comment, share, repost, save } = usePostActions(navigation, load);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Saved</Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onToggleLike={like}
            onComment={comment}
            onShare={share}
            onRepost={repost}
            onToggleSave={save}
            onPressUser={(uid) => navigation.navigate('UserProfile', { userId: uid })}
          />
        )}
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: 120 }}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Ionicons name="bookmark-outline" size={44} color={colors.cocoaFaint} />
              <Text style={styles.emptyTitle}>No saved posts yet</Text>
              <Muted style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
                Tap the bookmark on any post to save it here for later.
              </Muted>
            </View>
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
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 80,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.cocoa,
  },
});
