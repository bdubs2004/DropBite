import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostCard } from '../components/PostCard';
import { Muted } from '../components/ui';
import { usePostActions } from '../lib/usePostActions';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, spacing } from '../theme';
import { Post } from '../types';

/**
 * A single post, opened from the Discover grid.
 *
 * Loads by id rather than taking a Post through navigation params so the
 * screen is self-sufficient — counts are current, and it still works if the
 * caller only has an id.
 */
export function PostDetailScreen({ navigation, route }: any) {
  const postId: string = route.params.postId;
  const svc = getDataService();
  const { user } = useApp();
  const insets = useSafeAreaInsets();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // `showSpinner` only for the very first load — a focus reload after
  // commenting or liking should refresh the numbers silently, not blank the
  // card out behind a spinner.
  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      setPost(await svc.getPost(postId));
      setLoading(false);
    },
    [svc, postId],
  );

  // Reload every time the screen regains focus so a comment added (or a like
  // toggled) in the Comments modal is reflected in the counts on return.
  const firstLoad = useRef(true);
  useFocusEffect(
    useCallback(() => {
      load(firstLoad.current);
      firstLoad.current = false;
    }, [load]),
  );

  const pullRefresh = async () => {
    setRefreshing(true);
    try {
      await load(false);
    } finally {
      setRefreshing(false);
    }
  };

  const { like, comment, share, repost, save, remove, report } = usePostActions(
    navigation,
    () => load(false),
  );

  // Deleting from here leaves nothing to show, so step back to Discover.
  const removeAndLeave = async (p: Post) => {
    await remove(p);
    navigation.goBack();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Post</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={pullRefresh}
            tintColor={colors.amber}
            colors={[colors.amber]}
          />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
        ) : post ? (
          <PostCard
            post={post}
            onToggleLike={like}
            onComment={comment}
            onShare={share}
            onRepost={repost}
            onToggleSave={save}
            onPressUser={(uid) => navigation.push('UserProfile', { userId: uid })}
            onDelete={removeAndLeave}
            onReport={report}
            isMine={post.user_id === user?.id}
          />
        ) : (
          <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
            This post is no longer available.
          </Muted>
        )}
      </ScrollView>
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
});
