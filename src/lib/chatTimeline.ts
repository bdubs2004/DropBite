import { Message } from '../types';
import { daysBetween, localDateString } from './time';

/**
 * Instagram-style timestamps for a DM thread: a centred label wherever the
 * day changes, and each message's exact time for the swipe-to-reveal column.
 * Everything is in the device's local time (the database stores UTC).
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3:42 PM". Formatted by hand so it reads the same on every device. */
export function clockTime(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The divider label for the first message of a day:
 * "Today 3:42 PM", "Yesterday 9:05 AM", "Monday 4:10 PM" (this past week),
 * "Sep 28, 4:10 PM" (this year), "Sep 28, 2025, 4:10 PM" (older).
 */
export function dayDividerLabel(d: Date, now = new Date()): string {
  const ago = daysBetween(localDateString(d), localDateString(now));
  const time = clockTime(d);
  if (ago <= 0) return `Today ${time}`;
  if (ago === 1) return `Yesterday ${time}`;
  if (ago < 7) return `${DAYS[d.getDay()]} ${time}`;
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear()
    ? `${date}, ${time}`
    : `${date}, ${d.getFullYear()}, ${time}`;
}

export type TimelineItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: Message };

/** Messages (oldest first) with a day divider before each new day. */
export function buildTimeline(messages: Message[], now = new Date()): TimelineItem[] {
  const out: TimelineItem[] = [];
  let lastDay: string | null = null;
  for (const m of messages) {
    const d = new Date(m.created_at);
    const day = localDateString(d);
    if (day !== lastDay) {
      out.push({ kind: 'day', key: `day-${day}`, label: dayDividerLabel(d, now) });
      lastDay = day;
    }
    out.push({ kind: 'message', key: m.id, message: m });
  }
  return out;
}
