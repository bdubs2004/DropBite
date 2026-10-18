import * as Clipboard from 'expo-clipboard';
import { Linking, Platform, Share } from 'react-native';
import { smsUrl } from './shareText';

/**
 * The three ways out of the app, used by the share row (ShareTargets): copy,
 * text it, or the phone's own share sheet. Each says whether it worked and
 * never throws, so a button can't break the screen it sits on. The wording
 * lives in shareText.ts.
 */

export type ShareResult = 'shared' | 'copied' | 'failed';

function nav(): any {
  return typeof navigator !== 'undefined' ? navigator : undefined;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      const n = nav();
      if (!n?.clipboard?.writeText) return false;
      await n.clipboard.writeText(text);
      return true;
    }
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

/** Open Messages with the text filled in. False when there's no Messages. */
export async function openMessages(body: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    await Linking.openURL(smsUrl(body, Platform.OS));
    return true;
  } catch {
    return false;
  }
}

/**
 * The phone's share sheet. On iPhone the link goes in as its own `url`, which
 * is what makes iMessage and others show the rich preview with the photo.
 */
export async function systemShare({
  title,
  message,
  url,
}: {
  title: string;
  message: string;
  url?: string;
}): Promise<ShareResult> {
  const withUrl = url ? `${message}\n${url}` : message;
  try {
    if (Platform.OS === 'web') {
      const n = nav();
      if (n?.share) {
        await n.share({ title, text: message, ...(url ? { url } : {}) });
        return 'shared';
      }
      return (await copyText(url ?? withUrl)) ? 'copied' : 'failed';
    }
    const res =
      Platform.OS === 'ios' && url
        ? await Share.share({ title, message, url })
        : await Share.share({ title, message: withUrl });
    return res.action === Share.dismissedAction ? 'failed' : 'shared';
  } catch {
    return 'failed';
  }
}
