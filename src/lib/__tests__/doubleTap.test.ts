/**
 * Single vs double tap.
 *
 * Run with: npm run test:doubletap
 */
import { makeTapHandler } from '../doubleTap';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

// A fake clock and timer queue so nothing actually waits.
function rig(withSingle: boolean) {
  let clock = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const log: string[] = [];
  const h = makeTapHandler({
    onDouble: () => log.push('double'),
    onSingle: withSingle ? () => log.push('single') : undefined,
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: clock + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) {
      if (t.at <= clock) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    }
  };
  return { h, log, advance };
}

{
  const { h, log, advance } = rig(true);
  h.tap();
  advance(300);
  check('one tap runs the single action after the wait', log.join() === 'single');
}
{
  const { h, log, advance } = rig(true);
  h.tap();
  advance(150);
  h.tap();
  advance(400);
  check('two quick taps run only the double action', log.join() === 'double');
}
{
  const { h, log, advance } = rig(true);
  h.tap();
  advance(400);
  h.tap();
  advance(400);
  check('two slow taps are two single taps', log.join() === 'single,single');
}
{
  const { h, log, advance } = rig(false);
  h.tap();
  advance(100);
  h.tap();
  check('with no single action, the double fires at once', log.join() === 'double');
}
{
  const { h, log, advance } = rig(false);
  h.tap();
  advance(100);
  h.tap();
  advance(100);
  h.tap();
  check('a third quick tap does not double-fire', log.join() === 'double');
}
{
  const { h, log, advance } = rig(true);
  h.tap();
  h.cancel();
  advance(400);
  check('cancel drops a pending single tap', log.length === 0);
}

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
