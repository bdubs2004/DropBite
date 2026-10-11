import { NotificationType } from '../types';

/**
 * How each kind of Activity line reads: its icon, the badge colour (a palette
 * key) and the verb. Shared by the Activity list and the in-app banner so the
 * two always say the same thing.
 */
export const ACTIVITY_KIND: Record<
  NotificationType,
  { icon: any; tone: 'danger' | 'amber' | 'amberDark'; verb: string }
> = {
  like: { icon: 'heart', tone: 'danger', verb: 'liked your post' },
  comment: { icon: 'chatbubble', tone: 'amberDark', verb: 'commented on your post' },
  repost: { icon: 'repeat', tone: 'amberDark', verb: 'reposted your post' },
  share: { icon: 'paper-plane', tone: 'amberDark', verb: 'shared your post' },
  tag: { icon: 'pricetag', tone: 'amberDark', verb: 'tagged you in a post' },
  follow: { icon: 'person-add', tone: 'amber', verb: 'started following you' },
  follow_back: { icon: 'people', tone: 'amber', verb: 'followed you back' },
  comment_like: { icon: 'heart', tone: 'danger', verb: 'liked your comment' },
  reply: { icon: 'arrow-undo', tone: 'amberDark', verb: 'replied to your comment' },
};

/** Kinds that carry a comment's words (shown after the verb). */
export const SHOWS_COMMENT = new Set<NotificationType>(['comment', 'reply', 'comment_like']);
export const IS_FOLLOW = new Set<NotificationType>(['follow', 'follow_back']);

/**
 * Kinds that pop up as a banner while you're in the app: the same ones that
 * send a push (see supabase/functions/notify-activity). Shares, reposts and
 * tags stay quietly in Activity.
 */
export const BANNER_KINDS = new Set<NotificationType>([
  'like',
  'comment',
  'reply',
  'comment_like',
  'follow',
  'follow_back',
]);
