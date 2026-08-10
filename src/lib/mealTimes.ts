import { MealReminderSlot, NotificationPrefs } from '../types';

/**
 * Mealtime reminder times.
 *
 * Times are stored as "HH:MM" in 24-hour local time — no timezone, because a
 * daily local notification means "8pm wherever you are", which is what people
 * expect from a meal reminder when they travel.
 */

export const DEFAULT_MEAL_TIMES: Record<MealReminderSlot, string> = {
  breakfast: '08:00',
  lunch: '12:00',
  dinner: '18:00',
};

export const MEAL_REMINDER_SLOTS: MealReminderSlot[] = ['breakfast', 'lunch', 'dinner'];

/** Parse "HH:MM" into hour/minute, or null if it isn't a valid time. */
export function parseTime(value: string | undefined | null): { hour: number; minute: number } | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** The stored time for a slot, falling back to the default if unset/invalid. */
export function timeFor(prefs: NotificationPrefs, slot: MealReminderSlot): string {
  const raw = prefs.times?.[slot];
  return parseTime(raw) ? (raw as string) : DEFAULT_MEAL_TIMES[slot];
}

/** "18:30" -> "6:30 PM". Display only; storage stays 24-hour. */
export function formatTime(value: string): string {
  const parsed = parseTime(value);
  if (!parsed) return value;
  const { hour, minute } = parsed;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/**
 * Every selectable time, in 15-minute steps across the full day.
 *
 * 15 minutes is fine granularity for "remind me around dinner" and keeps the
 * list short enough to scroll, unlike a minute-level wheel.
 */
export function timeOptions(stepMinutes = 15): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += stepMinutes) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}
