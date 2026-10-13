/**
 * Recipe cards read from the server, and the nutrition worked out from them.
 *
 * Run with: npm run test:recipedata
 */
import { cleanNutrition, cleanRecipe } from '../recipeData';
import { forGrams, perServing, roundForDisplay, totalForRecipe } from '../nutrition';

let failures = 0;
function check(label: string, pass: boolean, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
}
const isText = (v: unknown) => typeof v === 'string';

// A card a scripted client saved before 0034, or an old build: every way of
// getting the shape wrong at once.
const hostile = cleanRecipe({
  id: 'r1',
  post_id: 'p1',
  title: { $ne: null },
  ingredients: [
    null,
    'salt',
    ['flour'],
    { item: { evil: true }, quantity: '1', unit: 'cup' },
    { item: 'garlic', quantity: 2, unit: { u: 1 }, grams: 'six', nutrition: { calories: 'lots' } },
    { item: 'butter', quantity: '1', unit: 'tbsp', grams: 14, nutrition: { calories: 100, fat_g: -11, protein_g: NaN } },
    { item: 'x'.repeat(1000), quantity: '9'.repeat(100) },
  ],
  steps: ['Chop.', { do: 'evil' }, null, 7, '', 's'.repeat(2000)],
  cook_time_minutes: -5,
  servings: 0,
  nutrition: { calories: Infinity, protein_g: '40', fat_g: 12 },
  nutrition_source: '<script>',
  ai_generated: 'yes',
});

check('a card that isn\'t an object is no card', cleanRecipe(null) === null && cleanRecipe('x') === null && cleanRecipe([1]) === null);
check('every ingredient field is text, so nothing can crash the screen',
  !!hostile && hostile.ingredients.every((i) => isText(i.item) && isText(i.quantity) && isText(i.unit)));
check('ingredients that aren\'t objects or have no name are dropped', hostile!.ingredients.map((i) => i.item.slice(0, 6)).join() === 'garlic,butter,xxxxxx');
check('numbers become text (quantity 2), objects become nothing', hostile!.ingredients[0].quantity === '2' && hostile!.ingredients[0].unit === '');
check('lengths are capped', hostile!.ingredients[2].item.length === 120 && hostile!.ingredients[2].quantity.length === 32);
check('a weight that isn\'t a number is unknown', hostile!.ingredients[0].grams === null);
check('ingredient nutrition that isn\'t numbers is dropped', hostile!.ingredients[0].nutrition === null);
check('negative or NaN nutrient values count as 0', hostile!.ingredients[1].nutrition?.fat_g === 0 && hostile!.ingredients[1].nutrition?.protein_g === 0 && hostile!.ingredients[1].nutrition?.calories === 100);
check('every step is text', hostile!.steps.every(isText) && hostile!.steps.join('|').startsWith('Chop.|7|'));
check('a step is at most 500 characters', hostile!.steps[2].length === 500);
check('a title that isn\'t text falls back', hostile!.title === 'My Recipe');
check('a negative cook time is no time', hostile!.cook_time_minutes === null);
check('0 servings is 1 (never divide by zero)', hostile!.servings === 1);
check('totals with Infinity or text keep only the real numbers', hostile!.nutrition?.calories === 0 && hostile!.nutrition?.protein_g === 0 && hostile!.nutrition?.fat_g === 12);
check('an unknown source is no source', hostile!.nutrition_source === null);
check('flags are only true when really true', hostile!.ai_generated === false);
check('no nutrition numbers at all is no label', cleanNutrition({ calories: 'x' }) === null && cleanNutrition([]) === null);

// The maths on top of it.
const total = totalForRecipe(hostile!.ingredients);
check('ingredients without nutrition are named as missing, not counted as zero',
  total.counted === 1 && total.missing.length === 2 && total.missing[0] === 'garlic');
check('the label never shows NaN or Infinity',
  Object.values(roundForDisplay(perServing(total.total, hostile!.servings ?? 1))).every((n) => Number.isFinite(n)));
for (const s of [0, -3, NaN, Infinity, 2.7, 1e9]) {
  const each = perServing({ calories: 400, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 }, s);
  check(`servings ${s}: one serving is a sensible slice`, Number.isFinite(each.calories) && each.calories >= 0 && each.calories <= 400, String(each.calories));
}
check('an unknown weight gives no nutrition, not zero', forGrams({ calories: 100 } as any, null) === null && forGrams({ calories: 100 } as any, -5) === null && forGrams({ calories: 100 } as any, NaN) === null);
check('a well-formed card comes through unchanged',
  JSON.stringify(cleanRecipe({ id: 'r', post_id: 'p', title: 'Fries', ingredients: [{ item: 'potato', quantity: '2', unit: '' }], steps: ['Fry.'], cook_time_minutes: 20, ai_generated: true, user_edited: false, servings: 2, nutrition: null, nutrition_source: null })) ===
    JSON.stringify({ id: 'r', post_id: 'p', title: 'Fries', ingredients: [{ item: 'potato', quantity: '2', unit: '', grams: null, fdc_id: null, nutrition: null }], steps: ['Fry.'], cook_time_minutes: 20, ai_generated: true, user_edited: false, servings: 2, nutrition: null, nutrition_source: null }));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nALL PASSED');
