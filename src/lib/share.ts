import { Platform, Share } from 'react-native';
import { Post } from '../types';

export type ShareResult = 'shared' | 'copied' | 'failed';

/**
 * Share a post using the OS share sheet on native, or the Web Share API /
 * clipboard fallback on web. Returns what actually happened so the UI can
 * confirm it.
 */
export async function sharePost(post: Post, link?: string): Promise<ShareResult> {
  const who = post.user?.display_name ? `${post.user.display_name} on nibl` : 'A meal on nibl';
  const place = post.restaurant_name ? ` (at ${post.restaurant_name})` : '';
  // The link is what makes an external share useful: it deep-links back
  // into the app rather than dumping plain text.
  const message = `${post.blurb}${place}\n\n${link ? `${link}\n\n` : ''}Shared from nibl`;

  try {
    if (Platform.OS === 'web') {
      const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav?.share) {
        await nav.share({ title: who, text: message, ...(link ? { url: link } : {}) });
        return 'shared';
      }
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(message);
        return 'copied';
      }
      return 'failed';
    }
    const res = await Share.share({ title: who, message });
    return res.action === Share.dismissedAction ? 'failed' : 'shared';
  } catch {
    return 'failed';
  }
}
