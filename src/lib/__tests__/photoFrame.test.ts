/**
 * Photo frames keep the whole picture.
 *
 * Run with: npm run test:photoframe
 */
import { DEFAULT_PHOTO_RATIO, fitWithin, photoFrame } from '../photoFrame';

let failures = 0;
function check(label: string, pass: boolean, got?: string) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${got !== undefined ? `  — ${got}` : ''}`);
}
const show = (f: { ratio: number; fit: string }) => `${f.ratio.toFixed(3)} ${f.fit}`;

const phone = photoFrame(3024, 4032);
check('a full portrait phone photo (3:4) gets its own frame, nothing cut', Math.abs(phone.ratio - 4 / 3) < 1e-9 && phone.fit === 'cover', show(phone));
const land = photoFrame(4032, 3024);
check('a landscape phone photo (4:3) gets its own frame', Math.abs(land.ratio - 0.75) < 1e-9 && land.fit === 'cover', show(land));
const sq = photoFrame(1080, 1080);
check('a square photo stays square', sq.ratio === 1 && sq.fit === 'cover', show(sq));
const insta = photoFrame(1080, 1350);
check('a 4:5 photo stays 4:5', Math.abs(insta.ratio - 1.25) < 1e-9 && insta.fit === 'cover', show(insta));
const tall = photoFrame(1170, 2532);
check('a very tall screenshot stops at 3:4 and fits inside (not cut)', Math.abs(tall.ratio - 4 / 3) < 1e-9 && tall.fit === 'contain', show(tall));
const pano = photoFrame(8000, 2000);
check('a panorama stops at 1.91:1 and fits inside (not cut)', Math.abs(pano.ratio - 1 / 1.91) < 1e-9 && pano.fit === 'contain', show(pano));
const odd = photoFrame(1199, 1600);
check('rounding off a 3:4 by a pixel still counts as a match', odd.fit === 'cover', show(odd));
const unknown = photoFrame(null, null);
check('unknown size falls back to 4:5', unknown.ratio === DEFAULT_PHOTO_RATIO && unknown.fit === 'cover', show(unknown));
check('zero size falls back too', photoFrame(0, 500).ratio === DEFAULT_PHOTO_RATIO);

const j = (x: unknown) => JSON.stringify(x);
check('a big portrait shrinks by its height', j(fitWithin(3024, 4032, 1600)) === j({ height: 1600 }), j(fitWithin(3024, 4032, 1600)));
check('a big landscape shrinks by its width', j(fitWithin(4032, 3024, 1600)) === j({ width: 1600 }), j(fitWithin(4032, 3024, 1600)));
check('a small photo is never enlarged', fitWithin(800, 1000, 1600) === null);
check('exactly at the cap is left alone', fitWithin(1600, 1200, 1600) === null);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
