import { useCallback } from 'react';
import { getDataService } from '../services';
import { sharePost } from './share';
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

  const share = useCallback(
    async (post: Post) => {
      const result = await sharePost(post);
      if (result !== 'failed') {
        await svc.recordShare(post.id);
        refresh();
      }
    },
    [svc, refresh],
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

  const remove = useCallback(
    async (post: Post) => {
      await svc.deletePost(post.id);
      refresh();
    },
    [svc, refresh],
  );

  return { like, comment, share, repost, save, remove };
}
