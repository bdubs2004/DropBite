import { GET_APP_URL } from '../config';
import type { Post } from '../types';
import { postUrl } from './links';

/**
 * What a share out of the app says. Kept apart from the share sheet itself so
 * the wording can be tested without a phone.
 *
 * A shared post sends a short line and its link, never the caption: the
 * link's preview card already shows the photo and the caption, and a long
 * caption pasted above it just looks like spam.
 */

const MEAL: Record<string, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snack: 'snack',
};

const HANDLE = /^[A-Za-z0-9_]{2,30}$/;

/** "Bryce’s", "Marcus’". */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/** "Bryce’s dinner on NiblGo", or "A meal on NiblGo" when there's no name. */
export function postShareTitle(post: Pick<Post, 'meal_slot' | 'user'>): string {
  const name = post.user?.display_name?.trim() || (post.user?.handle ? `@${post.user.handle}` : '');
  const meal = MEAL[post.meal_slot] ?? 'meal';
  return name ? `${possessive(name)} ${meal} on NiblGo` : 'A meal on NiblGo';
}

/**
 * The post's public link. With the sharer's handle as ?from=, the page (and the
 * app, for someone signing up from it) offers that handle as the invite code,
 * so the referral is recorded.
 */
export function postShareUrl(postId: string, fromHandle?: string | null): string {
  const base = postUrl(postId);
  return fromHandle && HANDLE.test(fromHandle) ? `${base}?from=${encodeURIComponent(fromHandle)}` : base;
}

/** The text an invite sends: the download link and your handle as the code. */
export function inviteMessage(handle: string): string {
  return (
    `I’m on NiblGo, where friends share what they’re eating. Come join me!\n` +
    `Get the app: ${GET_APP_URL}\n` +
    `Use @${handle} as your invite code when you sign up`
  );
}

/** A Messages compose link with the text filled in, per platform. */
export function smsUrl(body: string, os: string): string {
  // iOS wants "sms:&body=", Android "sms:?body=".
  return `${os === 'ios' ? 'sms:&body=' : 'sms:?body='}${encodeURIComponent(body)}`;
}
