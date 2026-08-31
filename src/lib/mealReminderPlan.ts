import { MealReminderSlot, NotificationPrefs } from '../types';
import { MEAL_REMINDER_SLOTS, parseTime, timeFor } from './mealTimes';

/**
 * Works out which mealtime reminders to cancel and which to schedule.
 *
 * Split out from services/notifications.ts because it is the part that can go
 * wrong quietly: schedule one reminder twice and the user gets two buzzes for
 * every meal, with nothing on screen to show why. Keeping it pure means it can
 * be tested without a device.
 *
 * Two rules make duplicates impossible:
 *
 *  1. Each slot has ONE stable identifier, so re-scheduling replaces the
 *     pending request instead of adding a second one next to it.
 *  2. Every reminder we recognise as ours is cancelled first — including ones
 *     with unfamiliar identifiers, which is how duplicates left behind by
 *     earlier versions get cleaned off the device.
 */

/** Stamped on every reminder we schedule, so we can recognise our own. */
export const MEAL_REMINDER_KIND = 'meal-reminder';

/** The one identifier used for a slot, for the life of the app. */
export function mealReminderId(slot: MealReminderSlot): string {
  return `niblgo-meal-${slot}`;
}

/** The bits of a pending notification this needs. */
export type ScheduledReminder = {
  identifier: string;
  data?: { kind?: unknown; slot?: unknown } | null;
};

export type PlannedReminder = {
  identifier: string;
  slot: MealReminderSlot;
  hour: number;
  minute: number;
};

export type MealReminderPlan = {
  /** Cancel these first. */
  cancel: string[];
  /** Then schedule these — at most one per slot, by construction. */
  schedule: PlannedReminder[];
};

/** True if we scheduled this, so it is ours to cancel. */
function isOurs(entry: ScheduledReminder): boolean {
  const data = entry?.data;
  if (!data) return false;
  if (data.kind === MEAL_REMINDER_KIND) return true;
  // Versions before the kind stamp only recorded the slot. Recognise those too,
  // otherwise their duplicates would stay on the device forever.
  return (
    typeof data.slot === 'string' &&
    (MEAL_REMINDER_SLOTS as string[]).includes(data.slot)
  );
}

export function planMealReminders(
  prefs: NotificationPrefs,
  existing: ScheduledReminder[] = [],
): MealReminderPlan {
  const schedule: PlannedReminder[] = [];
  for (const slot of MEAL_REMINDER_SLOTS) {
    if (!prefs[slot]) continue; // slot switched off
    const at = parseTime(timeFor(prefs, slot));
    if (!at) continue; // timeFor already falls back; belt and braces
    schedule.push({ identifier: mealReminderId(slot), slot, hour: at.hour, minute: at.minute });
  }

  const cancel = new Set<string>();
  for (const entry of existing) {
    // Anything we did not schedule is left strictly alone.
    if (isOurs(entry)) cancel.add(entry.identifier);
  }
  // Cancel the canonical ids regardless: if the device list could not be read,
  // this still guarantees we replace rather than stack.
  for (const planned of schedule) cancel.add(planned.identifier);

  return { cancel: [...cancel], schedule };
}
