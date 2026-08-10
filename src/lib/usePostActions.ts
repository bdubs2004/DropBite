import { useCallback } from 'react';
import { getDataService } from '../services';
import { Post } from '../types';

/**
 * Shared post-action handlers so every feed surface (Feed, Profile, Search)
 * behaves identically. `refresh` re-pulls whatever list the screen shows;
 * `navigation` is used to open the Comments modal.
 */
export function usePostActions(navigation: any, refresh: () => void) {
  const svc = getDataService();

  const like = useCallback(
    async (post: Post) => {
      await svc.toggleReaction(post.id);
      refresh();
    },
    [svc, refresh],
  );

  const comment = useCallback(
    (post: Post) => {
      navigation.navigate('Comments', { postId: post.id });
    },
    [navigation],
  );

  // Opens the share sheet, which offers both sending inside nibl and sharing
  // a deep link out of it. The sheet records the share itself.
  const share = useCallback(
    (post: Post) => {
      navigation.navigate('ShareSheet', { postId: post.id });
    },
    [navigation],
  );

  const repost = useCallback(
    async (post: Post) => {
      await svc.toggleRepost(post.id);
      refresh();
    },
    [svc, refresh],
  );

  const save = useCallback(
    async (post: Post) => {
      await svc.toggleSave(post.id);
      refresh();
    },
    [svc, refresh],
  );

  const report = useCallback(
    (post: Post) => {
      navigation.navigate('Report', { postId: post.id });
    },
    [navigation],
  );

  const remove = useCallback(
    async (post: Post) => {
      await svc.deletePost(post.id);
      refresh();
    },
    [svc, refresh],
  );

  return { like, comment, share, repost, save, remove, report };
}
