import { Platform } from 'react-native';
import {
  MEAL_REMINDER_KIND,
  planMealReminders,
  ScheduledReminder,
} from '../lib/mealReminderPlan';
import { serialQueue } from '../lib/serialQueue';
import { MealReminderSlot, NotificationPrefs } from '../types';

/**
 * Mealtime push notifications via local scheduled notifications
 * (no server needed; they fire in the user's own timezone by definition).
 * Web: gracefully no-ops.
 *
 * The hour/minute for each slot comes from the user's saved prefs, so someone
 * who eats dinner at 8pm gets reminded at 8pm. See src/lib/mealTimes.ts, and
 * src/lib/mealReminderPlan.ts for what gets cancelled and scheduled.
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

/**
 * Runs are queued, never concurrent.
 *
 * This is the other half of the duplicate fix. Sync is called whenever prefs
 * change, and it is a read-cancel-schedule sequence. Two overlapping runs could
 * both read the same pending state and both schedule, leaving two reminders per
 * meal. Queueing means the second run always sees the first one's finished
 * state. See src/lib/serialQueue.ts.
 */
export const syncMealtimeNotifications = serialQueue(applyMealtimeNotifications, false);

async function applyMealtimeNotifications(prefs: NotificationPrefs): Promise<boolean> {
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

    // Read what is actually pending on the device rather than assuming, so
    // duplicates left by an earlier version get swept up too.
    let existing: ScheduledReminder[] = [];
    try {
      const pending = await Notifications.getAllScheduledNotificationsAsync();
      existing = pending.map((n) => ({
        identifier: n.identifier,
        data: (n.content?.data ?? null) as ScheduledReminder['data'],
      }));
    } catch {
      // Fall through with an empty list: the plan still cancels our own ids.
    }

    const plan = planMealReminders(prefs, existing);

    for (const identifier of plan.cancel) {
      // Cancelling something already gone is not an error worth failing on.
      await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
    }

    for (const item of plan.schedule) {
      const copy = SLOT_COPY[item.slot];
      await Notifications.scheduleNotificationAsync({
        identifier: item.identifier,
        content: {
          title: copy.title,
          body: copy.body,
          data: { slot: item.slot, kind: MEAL_REMINDER_KIND },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: item.hour,
          minute: item.minute,
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}
