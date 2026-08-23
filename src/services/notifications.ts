import { Platform } from 'react-native';
import { MEAL_REMINDER_SLOTS, parseTime, timeFor } from '../lib/mealTimes';
import { MealReminderSlot, NotificationPrefs } from '../types';

/**
 * Mealtime push notifications via local scheduled notifications
 * (no server needed; they fire in the user's own timezone by definition).
 * Web: gracefully no-ops.
 *
 * The hour/minute for each slot comes from the user's saved prefs, so someone
 * who eats dinner at 8pm gets reminded at 8pm. See src/lib/mealTimes.ts.
 */

const SLOT_COPY: Record<MealReminderSlot, { title: string; body: string }> = {
  breakfast: {
    title: 'Breakfast on NiblGo',
    body: "What's on your plate this morning? Share it with your friends.",
  },
  lunch: {
    title: 'Lunch on NiblGo',
    body: 'Midday check-in. Show your friends what lunch looks like.',
  },
  dinner: {
    title: 'Dinner on NiblGo',
    body: 'Dinner time. Cooked or ordered, share it while it is hot.',
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

    // Clear and re-schedule wholesale: simpler than diffing, and this runs
    // only when prefs change.
    await Notifications.cancelAllScheduledNotificationsAsync();
    for (const slot of MEAL_REMINDER_SLOTS) {
      if (!prefs[slot]) continue;
      const at = parseTime(timeFor(prefs, slot));
      if (!at) continue; // timeFor already falls back, so this is belt-and-braces
      const copy = SLOT_COPY[slot];
      await Notifications.scheduleNotificationAsync({
        content: { title: copy.title, body: copy.body, data: { slot } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: at.hour,
          minute: at.minute,
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}
