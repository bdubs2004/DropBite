/**
 * Auto-hiding feed header.
 *
 * Run with: npm run test:header
 */
import { HeaderScrollState, nextHeaderState } from '../autoHideHeader';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

const run = (ys: number[], start: HeaderScrollState = { lastY: 0, travel: 0, hidden: false }) =>
  ys.reduce((s, y) => nextHeaderState(s, y, { topZone: 40 }), start);

check('starts shown', !run([]).hidden);
check('a tiny scroll down does not hide it', !run([30, 45, 50]).hidden);
check('scrolling down hides it', run([50, 80, 120]).hidden);
check('a small wobble back up while hidden keeps it hidden', run([50, 120, 300, 292]).hidden);
check('scrolling back up a bit brings it back', !run([50, 120, 300, 290, 280]).hidden);
check('direction flips reset the count', run([50, 120, 300, 280, 290, 320]).hidden);
check('back near the top it is always shown', !run([50, 120, 300, 30]).hidden);
check('pull-to-refresh overscroll keeps it shown', !run([-60, -20, 0]).hidden);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
