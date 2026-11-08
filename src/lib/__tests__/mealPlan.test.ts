// Week math for meal plans (src/lib/mealPlan.ts).
import { addDays, addMonths, dayName, longDay, monthGrid, monthLabel, nextSlot, weekDays, weekLabel, weekStart } from '../mealPlan';

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

const nov = monthGrid('2026-11-17');
check('November 2026 starts on the Monday before the 1st', nov[0] === '2026-10-26', nov[0]);
check('and ends on the Sunday after the 30th', nov[nov.length - 1] === '2026-12-06', nov[nov.length - 1]);
check('whole weeks only', nov.length % 7 === 0 && nov.length >= 28 && nov.length <= 42, nov.length);
check('a month starting on Monday has no days before it', monthGrid('2027-02-10')[0] === '2027-02-01', monthGrid('2027-02-10')[0]);
check('next month from the 31st lands on the last day', addMonths('2027-01-31', 1) === '2027-02-28', addMonths('2027-01-31', 1));
check('across a year', addMonths('2026-12-15', 1) === '2027-01-15' && addMonths('2026-01-15', -1) === '2025-12-15');
check('month and day names', monthLabel('2026-11-05') === 'November 2026' && longDay('2026-11-05') === 'Thursday, Nov 5', longDay('2026-11-05'));

// Saved recipes (src/lib/myRecipe.ts)
import { cleanMyRecipe, recipeSummary, tidyRecipe } from '../myRecipe';
const tidy = tidyRecipe(
  { title: '  ', ingredients: [{ item: ' beef ', quantity: '2', unit: 'lb' }, { item: '', quantity: '1', unit: '' }], steps: ['', ' Brown it '], cook_time_minutes: 99999 },
  'Taco night',
);
check('an empty title falls back to the meal name', tidy.title === 'Taco night', tidy.title);
check('empty rows are dropped and text trimmed', tidy.ingredients.length === 1 && tidy.ingredients[0].item === 'beef' && tidy.steps.length === 1 && tidy.steps[0] === 'Brown it', tidy);
check('cook time kept within the database limit', tidy.cook_time_minutes === 6000, tidy.cook_time_minutes);
const clean = cleanMyRecipe({ id: 'r1', user_id: 'u1', title: 'Soup', ingredients: [{ item: 'leek', quantity: 2 }, 'junk', { quantity: '1' }], steps: ['Boil', 7, ''], cook_time_minutes: -5 });
check('a saved recipe from the server is cleaned', !!clean && clean.ingredients.length === 1 && clean.ingredients[0].quantity === '2' && clean.steps.length === 2 && clean.cook_time_minutes === null, clean);
check('nonsense is nothing', cleanMyRecipe('nope') === null && cleanMyRecipe(null) === null);
check('summary', recipeSummary({ ingredients: [1, 2, 3], cook_time_minutes: 30 }) === '3 ingredients · 30 min' && recipeSummary({ ingredients: [], cook_time_minutes: null }) === '');

console.log(failed ? `\n${failed} meal plan check(s) failed` : '\nAll meal plan checks passed');
if (failed) process.exit(1);
