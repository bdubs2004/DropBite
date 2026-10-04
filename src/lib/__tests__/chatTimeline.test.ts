/**
 * DM day dividers and message times.
 *
 * Run with: npm run test:timeline
 */
import { Message } from '../../types';
import { buildTimeline, clockTime, dayDividerLabel } from '../chatTimeline';

let failures = 0;
function check(label: string, pass: boolean, got?: string) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${got !== undefined ? `  — ${got}` : ''}`);
}

// Local-time dates, so the test means the same thing in any timezone.
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);
const now = at(2026, 10, 4, 18, 0); // Sunday Oct 4 2026, 6pm

check('afternoon time', clockTime(at(2026, 10, 4, 15, 42)) === '3:42 PM', clockTime(at(2026, 10, 4, 15, 42)));
check('just after midnight is 12, not 0', clockTime(at(2026, 10, 4, 0, 5)) === '12:05 AM', clockTime(at(2026, 10, 4, 0, 5)));
check('noon', clockTime(at(2026, 10, 4, 12, 0)) === '12:00 PM');

const L = (d: Date) => dayDividerLabel(d, now);
check('today', L(at(2026, 10, 4, 9, 5)) === 'Today 9:05 AM', L(at(2026, 10, 4, 9, 5)));
check('yesterday', L(at(2026, 10, 3, 23, 59)) === 'Yesterday 11:59 PM', L(at(2026, 10, 3, 23, 59)));
check('earlier this week shows the weekday', L(at(2026, 9, 28, 16, 10)) === 'Monday 4:10 PM', L(at(2026, 9, 28, 16, 10)));
check('a week or more ago shows the date', L(at(2026, 9, 27, 16, 10)) === 'Sep 27, 4:10 PM', L(at(2026, 9, 27, 16, 10)));
check('last year adds the year', L(at(2025, 12, 31, 20, 0)) === 'Dec 31, 2025, 8:00 PM', L(at(2025, 12, 31, 20, 0)));

const msg = (id: string, d: Date) => ({ id, created_at: d.toISOString() }) as Message;
const t = buildTimeline(
  [
    msg('a', at(2026, 10, 2, 10, 0)),
    msg('b', at(2026, 10, 2, 22, 0)),
    msg('c', at(2026, 10, 3, 8, 0)),
    msg('d', at(2026, 10, 4, 9, 0)),
    msg('e', at(2026, 10, 4, 17, 0)),
  ],
  now,
);
const shape = t.map((i) => (i.kind === 'day' ? `[${i.label}]` : i.message.id)).join(' ');
check(
  'a divider goes before the first message of each day, and only then',
  shape === '[Friday 10:00 AM] a b [Yesterday 8:00 AM] c [Today 9:00 AM] d e',
  shape,
);
check('no messages, no dividers', buildTimeline([], now).length === 0);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
