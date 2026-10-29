// Picking the right USDA food (supabase/functions/_shared/usda.ts).
// Run: npm run test:usda
import { cacheKey, per100gFrom, pickBestFood, words } from '../usda.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

const food = (description: string, sodium = 0, protein = 0) => ({
  description,
  foodNutrients: [
    { nutrientNumber: '307', value: sodium },
    { nutrientNumber: '203', value: protein },
    { nutrientNumber: '208', value: 400 },
  ],
});

// USDA's search for popcorn puts the plain kind first, as it does for real.
const popcornResults = [
  food('Snacks, popcorn, air-popped', 8, 12.9),
  food('Snacks, popcorn, oil-popped, white popcorn', 4, 9),
  food('Snacks, popcorn, cakes', 288, 9.7),
  food('Snacks, popcorn, microwave, regular (butter) flavor, made with partially hydrogenated oil', 884, 7.3),
  food('Snacks, popcorn, caramel-coated, with peanuts', 286, 6.4),
];

let pick = pickBestFood('microwave popcorn butter', popcornResults);
check('microwave butter popcorn finds microwave butter popcorn, not air-popped', /microwave/.test(String(pick?.description)), String(pick?.description));
check('…so its sodium is hundreds of mg, not 8', per100gFrom(pick)?.sodium_mg === 884);

pick = pickBestFood('popcorn', popcornResults);
check('plain "popcorn" still means plain popcorn (USDA order kept)', String(pick?.description) === 'Snacks, popcorn, air-popped', String(pick?.description));

pick = pickBestFood('caramel popcorn', popcornResults);
check('caramel popcorn finds the caramel one', /caramel/.test(String(pick?.description)), String(pick?.description));

const eggResults = [
  food('Egg, whole, raw, fresh', 142, 12.6),
  food('Egg, white, raw, fresh', 166, 10.9),
  food('Egg, yolk, raw, fresh', 48, 15.9),
];
pick = pickBestFood('egg', eggResults);
check('"egg" stays whole egg, not the shorter "egg white"', String(pick?.description) === 'Egg, whole, raw, fresh', String(pick?.description));
pick = pickBestFood('eggs', eggResults);
check('plurals match ("eggs" finds egg)', String(pick?.description) === 'Egg, whole, raw, fresh', String(pick?.description));
pick = pickBestFood('egg white', eggResults);
check('"egg white" finds egg white', /white/.test(String(pick?.description)), String(pick?.description));

const chickenResults = [
  food('Soup, chicken noodle, canned', 343, 3),
  food('Chicken, broilers or fryers, breast, meat only, cooked, roasted', 74, 31),
];
pick = pickBestFood('chicken breast', chickenResults);
check('chicken breast finds chicken breast over soup that ranked first', /breast/.test(String(pick?.description)), String(pick?.description));

check('nothing in common: no match, not a wrong one', pickBestFood('kombucha', popcornResults) === null);
check('no results: no match', pickBestFood('popcorn', []) === null);
check('nutrients read from either response shape', per100gFrom({ foodNutrients: [{ nutrient: { number: '203' }, amount: 5 }] })?.protein_g === 5);
check('a result with no nutrients is no match', per100gFrom({ foodNutrients: [] }) === null);
check('words: lowercase, punctuation and filler dropped', words('Snacks, popcorn, air-popped (with salt)').join(' ') === 'snack popcorn air popped salt', words('Snacks, popcorn, air-popped (with salt)').join(' '));
check('cache keys are versioned, so old first-hit matches are not reused', cacheKey('popcorn') === 'v2|popcorn' && cacheKey('x'.repeat(200)).length === 120);

console.log(failed ? `\n${failed} USDA check(s) failed` : '\nAll USDA checks passed');
if (failed) process.exit(1);
