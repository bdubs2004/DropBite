/**
 * Pinch-to-zoom math.
 *
 * Run with: npm run test:pinch
 */
import { MAX_SCALE, pinchTransform, Point } from '../pinchMath';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
const center: Point = { x: 200, y: 300 };
const zero: Point = { x: 0, y: 0 };
// Where photo point q lands on screen for a given transform.
const onScreen = (q: Point, s: number, t: Point) => ({
  x: center.x + t.x + s * q.x,
  y: center.y + t.y + s * q.y,
});

// Spreading the fingers to twice the distance doubles the zoom.
{
  const r = pinchTransform({
    center,
    start: [{ x: 150, y: 300 }, { x: 250, y: 300 }],
    now: [{ x: 100, y: 300 }, { x: 300, y: 300 }],
    baseScale: 1,
    baseT: zero,
  });
  check('fingers twice as far apart = 2x zoom', near(r.scale, 2));
  check('pinching around the center keeps it centered', near(r.t.x, 0) && near(r.t.y, 0));
}

// Pinching off-center keeps the pinched spot under the fingers.
{
  const start = [{ x: 260, y: 380 }, { x: 300, y: 420 }];
  const now = [{ x: 240, y: 360 }, { x: 320, y: 440 }];
  const r = pinchTransform({ center, start, now, baseScale: 1, baseT: zero });
  // The pinched spot started at the fingers' midpoint (280, 400), i.e. q = (80, 100).
  const landed = onScreen({ x: 80, y: 100 }, r.scale, r.t);
  check('off-center pinch zooms around the fingers', near(landed.x, 280) && near(landed.y, 400));
}

// Moving both fingers together drags the zoomed photo.
{
  const r = pinchTransform({
    center,
    start: [{ x: 150, y: 300 }, { x: 250, y: 300 }],
    now: [{ x: 180, y: 340 }, { x: 280, y: 340 }],
    baseScale: 2,
    baseT: zero,
  });
  check('two-finger drag pans without changing zoom', near(r.scale, 2) && near(r.t.x, 30) && near(r.t.y, 40));
}

// One finger left on the photo drags it at the zoom you reached.
{
  const r = pinchTransform({
    center,
    start: [{ x: 220, y: 310 }],
    now: [{ x: 250, y: 290 }],
    baseScale: 3,
    baseT: { x: 10, y: -5 },
  });
  check('one finger pans at the current zoom', near(r.scale, 3) && near(r.t.x, 40) && near(r.t.y, -25));
}

// Limits: can't shrink below normal size, can't zoom forever.
{
  const shrink = pinchTransform({
    center,
    start: [{ x: 100, y: 300 }, { x: 300, y: 300 }],
    now: [{ x: 190, y: 300 }, { x: 210, y: 300 }],
    baseScale: 1,
    baseT: zero,
  });
  check('pinching in stops at normal size', near(shrink.scale, 1));
  const huge = pinchTransform({
    center,
    start: [{ x: 199, y: 300 }, { x: 201, y: 300 }],
    now: [{ x: 0, y: 300 }, { x: 400, y: 300 }],
    baseScale: 1,
    baseT: zero,
  });
  check('zoom is capped', near(huge.scale, MAX_SCALE));
}

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
