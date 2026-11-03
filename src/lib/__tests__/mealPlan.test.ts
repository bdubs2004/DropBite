// Week math for meal plans (src/lib/mealPlan.ts).
import { addDays, dayName, nextSlot, weekDays, weekLabel, weekStart } from '../mealPlan';

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — got: ${JSON.stringify(got)}`}`);
};

check('a week starts on Monday', weekStart('2026-11-12') === '2026-11-09', weekStart('2026-11-12'));
check('Monday is its own week start', weekStart('2026-11-09') === '2026-11-09');
check('Sunday belongs to the week before it', weekStart('2026-11-15') === '2026-11-09', weekStart('2026-11-15'));
check('across a month end', weekStart('2026-12-02') === '2026-11-30');
check('across a year end', addDays('2026-12-31', 1) === '2027-01-01');
check('across the clocks going back (US, Nov 1 2026)', addDays('2026-10-31', 1) === '2026-11-01' && addDays('2026-11-01', 1) === '2026-11-02');
check('seven days, Monday to Sunday', JSON.stringify(weekDays('2026-11-09')) === JSON.stringify(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']));
check('today and tomorrow by name', dayName('2026-11-12', '2026-11-12') === 'Today' && dayName('2026-11-13', '2026-11-12') === 'Tomorrow');
check('other days by weekday', dayName('2026-11-15', '2026-11-12') === 'Sunday', dayName('2026-11-15', '2026-11-12'));
check('this, next and last week', weekLabel('2026-11-09', '2026-11-12') === 'This week' && weekLabel('2026-11-16', '2026-11-12') === 'Next week' && weekLabel('2026-11-02', '2026-11-12') === 'Last week');
check('further weeks show their dates', weekLabel('2026-11-23', '2026-11-12') === 'Nov 23 to 29' && weekLabel('2026-11-30', '2026-11-12') === 'Nov 30 to Dec 6', weekLabel('2026-11-30', '2026-11-12'));
check('the next meal by the hour', nextSlot(7) === 'breakfast' && nextSlot(12) === 'lunch' && nextSlot(19) === 'dinner');

console.log(failed ? `\n${failed} meal plan check(s) failed` : '\nAll meal plan checks passed');
if (failed) process.exit(1);
