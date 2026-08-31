/**
 * Mealtime reminder planning.
 *
 * Run with: npm run test:reminders
 *
 * These exist because of a real bug: users got two notifications for every
 * meal. Two causes, both covered below — the launch sync ran with the default
 * times before the saved ones loaded, and overlapping runs each cleared and
 * then re-scheduled, so both sets survived.
 */
import {
  MEAL_REMINDER_KIND,
  mealReminderId,
  planMealReminders,
  ScheduledReminder,
} from '../mealReminderPlan';
import { serialQueue } from '../serialQueue';
import { NotificationPrefs } from '../../types';

let failures = 0;
function check(label: string, pass: boolean, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
}

const ALL_ON: NotificationPrefs = { breakfast: true, lunch: true, dinner: true };

/** What the device holds after applying a plan to a given starting state. */
function apply(existing: ScheduledReminder[], prefs: NotificationPrefs): ScheduledReminder[] {
  const plan = planMealReminders(prefs, existing);
  const kept = existing.filter((e) => !plan.cancel.includes(e.identifier));
  return [
    ...kept,
    ...plan.schedule.map((s) => ({
      identifier: s.identifier,
      data: { kind: MEAL_REMINDER_KIND, slot: s.slot },
    })),
  ];
}

// 1. A clean device gets exactly one reminder per enabled slot.
{
  const plan = planMealReminders(ALL_ON, []);
  check('1. three reminders on a clean device', plan.schedule.length === 3,
    `(${plan.schedule.map((s) => `${s.slot} ${s.hour}:${String(s.minute).padStart(2, '0')}`).join(', ')})`);
}

// 2. Custom times are used, not the defaults.
{
  const prefs: NotificationPrefs = { ...ALL_ON, times: { dinner: '20:30' } };
  const dinner = planMealReminders(prefs, []).schedule.find((s) => s.slot === 'dinner');
  check('2. a custom dinner time is honoured', dinner?.hour === 20 && dinner?.minute === 30,
    `(${dinner?.hour}:${dinner?.minute})`);
}

// 3. Syncing twice in sequence must not leave two reminders per meal.
{
  let device = apply([], ALL_ON);
  device = apply(device, ALL_ON);
  const perSlot = device.filter((d) => (d.data as any)?.slot === 'dinner').length;
  check('3. syncing twice leaves ONE dinner reminder', device.length === 3 && perSlot === 1,
    `(${device.length} total, ${perSlot} dinner)`);
}

// 4. THE OTHER HALF: a sync with default times followed by one with the saved
//    times must leave only the saved time — this is what produced a buzz at
//    both 6pm and 8pm.
{
  const saved: NotificationPrefs = { ...ALL_ON, times: { dinner: '20:00' } };
  let device = apply([], ALL_ON);        // launch, before prefs loaded
  device = apply(device, saved);         // prefs arrive
  const dinners = device.filter((d) => (d.data as any)?.slot === 'dinner');
  const plan = planMealReminders(saved, apply([], ALL_ON));
  check('4. a default-times sync is replaced, not added to',
    dinners.length === 1 && plan.schedule.find((s) => s.slot === 'dinner')?.hour === 20,
    `(${dinners.length} dinner reminders)`);
}

// 5. Duplicates left by an earlier version are swept up, even though their
//    identifiers are random and they carry no kind stamp.
{
  const legacy: ScheduledReminder[] = [
    { identifier: 'random-uuid-1', data: { slot: 'dinner' } },
    { identifier: 'random-uuid-2', data: { slot: 'dinner' } },
    { identifier: 'random-uuid-3', data: { slot: 'lunch' } },
  ];
  const device = apply(legacy, ALL_ON);
  check('5. legacy duplicates are cleaned off the device',
    device.length === 3 && device.every((d) => d.identifier.startsWith('niblgo-meal-')),
    `(${device.map((d) => d.identifier).join(', ')})`);
}

// 6. Someone else's notifications are never touched.
{
  const other: ScheduledReminder[] = [
    { identifier: 'streak-nudge', data: { kind: 'streak' } },
    { identifier: 'no-data-at-all', data: null },
  ];
  const plan = planMealReminders(ALL_ON, other);
  check('6. unrelated notifications are left alone',
    !plan.cancel.includes('streak-nudge') && !plan.cancel.includes('no-data-at-all'),
    `(cancelling ${plan.cancel.join(', ')})`);
}

// 7. Turning a slot off cancels it and schedules nothing in its place.
{
  const device = apply(apply([], ALL_ON), { ...ALL_ON, lunch: false });
  check('7. switching lunch off removes its reminder',
    device.length === 2 && !device.some((d) => (d.data as any)?.slot === 'lunch'),
    `(${device.map((d) => (d.data as any)?.slot).join(', ')})`);
}

// 8. All three off leaves nothing scheduled.
{
  const device = apply(apply([], ALL_ON), { breakfast: false, lunch: false, dinner: false });
  check('8. all slots off leaves nothing scheduled', device.length === 0, `(${device.length})`);
}

// 9. An invalid stored time falls back rather than scheduling nonsense.
{
  const prefs = { ...ALL_ON, times: { dinner: '25:99' } } as NotificationPrefs;
  const dinner = planMealReminders(prefs, []).schedule.find((s) => s.slot === 'dinner');
  check('9. an invalid time falls back to the default', dinner?.hour === 18 && dinner?.minute === 0,
    `(${dinner?.hour}:${dinner?.minute})`);
}

// 10. The identifier for a slot is stable — that is what makes a re-schedule
//     replace rather than stack.
{
  check('10. slot identifiers are stable',
    mealReminderId('dinner') === 'niblgo-meal-dinner' &&
      mealReminderId('dinner') === mealReminderId('dinner'));
}

/**
 * 11-13. THE ACTUAL BUG: two syncs overlapping in time.
 *
 * Sequential planning was never the problem; the read-cancel-schedule sequence
 * interleaving was. 11 replays the OLD implementation to prove this harness can
 * reproduce the duplicates users saw. 12 and 13 show the two independent fixes
 * — the queue, and the stable identifiers — each closing it on their own.
 */
type Sync = (prefs: NotificationPrefs) => Promise<boolean>;
const tick = () => new Promise((r) => setTimeout(r, 5));

/** What the code used to do: clear everything, then add with random ids. */
function legacySync(device: { get: () => ScheduledReminder[]; set: (d: ScheduledReminder[]) => void }): Sync {
  let n = 0;
  return async (prefs) => {
    await tick();
    device.set([]); // cancelAllScheduledNotificationsAsync
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      if (!prefs[slot]) continue;
      await tick(); // each schedule call was its own await
      device.set([...device.get(), { identifier: `random-${n++}`, data: { slot } }]);
    }
    return true;
  };
}

/** What it does now: plan against what is pending, using stable ids. */
function plannedSync(device: { get: () => ScheduledReminder[]; set: (d: ScheduledReminder[]) => void }): Sync {
  return async (prefs) => {
    const plan = planMealReminders(prefs, device.get());
    await tick(); // the window where the notifications API is awaited
    const kept = device.get().filter((d) => !plan.cancel.includes(d.identifier));
    device.set([
      ...kept,
      ...plan.schedule.map((x) => ({
        identifier: x.identifier,
        data: { kind: MEAL_REMINDER_KIND, slot: x.slot },
      })),
    ]);
    return true;
  };
}

function box() {
  let value: ScheduledReminder[] = [];
  return { get: () => value, set: (d: ScheduledReminder[]) => { value = d; } };
}

/** Two syncs fired at once, the way launch and a prefs change could collide. */
async function race(make: (b: ReturnType<typeof box>) => Sync, serialised: boolean) {
  const b = box();
  const inner = make(b);
  const sync = serialised ? serialQueue(inner, false) : inner;
  await Promise.all([sync(ALL_ON), sync({ ...ALL_ON, times: { dinner: '20:00' } })]);
  return b.get();
}

const dinners = (d: ScheduledReminder[]) => d.filter((x) => (x.data as any)?.slot === 'dinner').length;

(async () => {
  const before = await race(legacySync, false);
  check('11. the OLD code really did duplicate under a race (control)',
    before.length > 3 && dinners(before) > 1,
    `(${before.length} reminders, ${dinners(before)} for dinner)`);

  const queued = await race(legacySync, true);
  check('12. the queue alone fixes it', queued.length === 3 && dinners(queued) === 1,
    `(${queued.length} reminders, ${dinners(queued)} for dinner)`);

  const planned = await race(plannedSync, false);
  check('13. stable identifiers alone fix it too', planned.length === 3 && dinners(planned) === 1,
    `(${planned.length} reminders, ${dinners(planned)} for dinner)`);

  console.log('');
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})();
