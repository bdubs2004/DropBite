/**
 * Drawer drag math.
 *
 * Run with: npm run test:drawer
 */
import {
  drawerTranslate,
  isHorizontalDrag,
  shouldCloseDrawer,
} from '../drawerGesture';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

const WIDTH = 300;

// Follow the finger toward closed, clamp at open.
check('follows the finger to the right', drawerTranslate(120) === 120);
check('never pulls past fully-open', drawerTranslate(-80) === 0);
check('open position stays open', drawerTranslate(0) === 0);

// Horizontal vs vertical intent.
check('a clear rightward drag is horizontal', isHorizontalDrag(30, 4));
check('a tiny move is ignored', !isHorizontalDrag(3, 0));
check('a mostly-vertical drag is not horizontal', !isHorizontalDrag(10, 40));

// Release decision: past halfway or a flick closes; otherwise snaps back.
check('past halfway closes', shouldCloseDrawer(WIDTH * 0.5 + 1, 0, WIDTH));
check('just under halfway snaps back', !shouldCloseDrawer(WIDTH * 0.5 - 1, 0, WIDTH));
check('a fast flick closes even when short', shouldCloseDrawer(20, 0.9, WIDTH));
check('a small slow nudge snaps back', !shouldCloseDrawer(20, 0.1, WIDTH));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nALL PASSED');
