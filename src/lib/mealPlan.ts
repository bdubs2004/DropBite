import { MealSlot } from '../types';

/**
 * Week math for the meal plan. Plan days are calendar days ("2026-11-09"),
 * not moments, so everything here works on local dates and never on UTC
 * timestamps (a dinner planned for Tuesday stays on Tuesday in any time zone).
 */

export const PLAN_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-09" for a local date. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local date for "2026-11-09" (midday, so DST shifts can't move the day). */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** The Monday of the week a day is in. */
export function weekStart(key: string): string {
  const d = fromKey(key);
  const back = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(key, -back);
}

/** The seven days of the week starting on a Monday. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Tomorrow", or "Wednesday". */
export function dayName(key: string, today: string): string {
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  return DAYS[fromKey(key).getDay()];
}

/** "Nov 9". */
export function shortDate(key: string): string {
  const d = fromKey(key);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "This week", "Next week", "Last week", or "Nov 9 to 15". */
export function weekLabel(monday: string, today: string): string {
  const thisMonday = weekStart(today);
  if (monday === thisMonday) return 'This week';
  if (monday === addDays(thisMonday, 7)) return 'Next week';
  if (monday === addDays(thisMonday, -7)) return 'Last week';
  const sunday = addDays(monday, 6);
  const a = fromKey(monday);
  const b = fromKey(sunday);
  return a.getMonth() === b.getMonth()
    ? `${MONTHS[a.getMonth()]} ${a.getDate()} to ${b.getDate()}`
    : `${shortDate(monday)} to ${shortDate(sunday)}`;
}

/** The meal that's next at this hour: breakfast before 10, lunch before 3, else dinner. */
export function nextSlot(hour: number): MealSlot {
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  return 'dinner';
}

/** The first of the month a day is in. */
export function monthStart(key: string): string {
  return key.slice(0, 8) + '01';
}

/** The same day n months away, kept inside the shorter month (Jan 31 + 1 = Feb 28). */
export function addMonths(key: string, n: number): string {
  const d = fromKey(key);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(day, last));
  return dayKey(target);
}

/** Whole weeks, Monday first, that cover the month a day is in (28 to 42 days). */
export function monthGrid(key: string): string[] {
  const first = monthStart(key);
  const lastDay = addDays(addMonths(first, 1), -1);
  const start = weekStart(first);
  const end = addDays(weekStart(lastDay), 6);
  const out: string[] = [];
  for (let k = start; k <= end; k = addDays(k, 1)) out.push(k);
  return out;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 2026". */
export function monthLabel(key: string): string {
  const d = fromKey(key);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Thursday, Nov 5". */
export function longDay(key: string): string {
  return `${DAYS[fromKey(key).getDay()]}, ${shortDate(key)}`;
}
