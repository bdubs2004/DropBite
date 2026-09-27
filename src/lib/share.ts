import { Platform, Share } from 'react-native';
import { Post } from '../types';

export type ShareResult = 'shared' | 'copied' | 'failed';

/**
 * Share a post using the OS share sheet on native, or the Web Share API /
 * clipboard fallback on web. Returns what actually happened so the UI can
 * confirm it.
 */
export async function sharePost(post: Post, link?: string): Promise<ShareResult> {
  const who = post.user?.display_name ? `${post.user.display_name} on NiblGo` : 'A meal on NiblGo';
  const place = post.restaurant_name ? ` (at ${post.restaurant_name})` : '';
  // Keep the text short and let the link's preview card carry the photo,
  // caption and branding: the URL resolves to niblgo.com/post/<id>, which
  // renders a rich Open Graph card and an "Open in NiblGo" button. A short
  // caption line still gives context in apps that don't unfurl links.
  const caption = post.blurb ? `${post.blurb}${place}` : `A meal on NiblGo${place}`;
  const message = link ? `${caption}\n${link}` : caption;

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
