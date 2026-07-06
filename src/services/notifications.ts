import { Platform } from 'react-native';
import { NotificationPrefs } from '../types';

/**
 * Mealtime push notifications via local scheduled notifications
 * (no server needed — they fire in the user's own timezone by definition).
 * Web: gracefully no-ops.
 */

const SLOT_TIMES: Record<keyof NotificationPrefs, { hour: number; minute: number; title: string; body: string }> = {
  breakfast: {
    hour: 8,
    minute: 0,
    title: 'Breakfast drop 🍳',
    body: "What's on your plate this morning? Drop it before it's gone.",
  },
  lunch: {
    hour: 12,
    minute: 0,
    title: 'Lunch drop 🥪',
    body: 'Midday check-in — show your friends what lunch looks like.',
  },
  dinner: {
    hour: 18,
    minute: 0,
    title: 'Dinner drop 🍲',
    body: "Dinner time. Cooked or ordered, let's see it.",
  },
};

export async function syncMealtimeNotifications(prefs: NotificationPrefs): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return false;

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    await Notifications.cancelAllScheduledNotificationsAsync();
    for (const slot of Object.keys(SLOT_TIMES) as (keyof NotificationPrefs)[]) {
      if (!prefs[slot]) continue;
      const t = SLOT_TIMES[slot];
      await Notifications.scheduleNotificationAsync({
        content: { title: t.title, body: t.body, data: { slot } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: t.hour,
          minute: t.minute,
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}
