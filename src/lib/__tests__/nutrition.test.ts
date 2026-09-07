/**
 * Recipe nutrition maths.
 *
 * Run with: npm run test:nutrition
 *
 * The serving-size cases are the point of this file. A pie's totals divided by
 * one instead of four is a 4x error on a number people use to make decisions
 * about what they eat, and it looks perfectly plausible on screen.
 */
import {
  addNutrition,
  EMPTY_NUTRITION,
  forGrams,
  Nutrition,
  perServing,
  roundForDisplay,
  servingFractionLabel,
  servingsLabel,
  totalForRecipe,
} from '../nutrition';
import { Ingredient } from '../../types';

let failures = 0;
function check(label: string, pass: boolean, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
}

/** Butter, per 100 g, roughly. Only the arithmetic is under test here. */
const BUTTER_100G: Nutrition = {
  calories: 717,
  protein_g: 0.85,
  carbs_g: 0.06,
  fat_g: 81,
  fiber_g: 0,
  sugar_g: 0.06,
  sodium_mg: 11,
};

const ing = (item: string, nutrition: Nutrition | null, grams: number | null = 100): Ingredient => ({
  item,
  quantity: '',
  unit: '',
  grams,
  nutrition,
});

// 1. Scaling per-100g to an actual weight.
{
  const half = forGrams(BUTTER_100G, 50);
  check('1. 50 g of butter is half the per-100g figures',
    half !== null && Math.abs(half.calories - 358.5) < 0.01 && Math.abs(half.fat_g - 40.5) < 0.01,
    `(${half?.calories} kcal)`);
}

// 2. An unknown weight yields null, never zero.
{
  check('2. unknown weight gives null, not a silent zero',
    forGrams(BUTTER_100G, null) === null &&
      forGrams(BUTTER_100G, 0) === null &&
      forGrams(BUTTER_100G, NaN) === null);
}

// 3. Ingredients without nutrition are reported, not dropped.
{
  const { total, counted, missing } = totalForRecipe([
    ing('butter', forGrams(BUTTER_100G, 100)),
    ing('a pinch of magic', null, null),
  ]);
  check('3. an unknown ingredient is named, not silently skipped',
    counted === 1 && missing.length === 1 && missing[0] === 'a pinch of magic' &&
      Math.abs(total.calories - 717) < 0.01,
    `(counted ${counted}, missing ${JSON.stringify(missing)})`);
}

// 4. THE PIE. Totals stay whole; servings divide at display time.
{
  const pie = totalForRecipe([
    ing('butter', forGrams(BUTTER_100G, 200)), // 1434 kcal
  ]).total;
  const whole = roundForDisplay(perServing(pie, 1));
  const quarter = roundForDisplay(perServing(pie, 4));
  check('4. a pie split four ways is a quarter of the calories',
    whole.calories === 1435 && quarter.calories === 360,
    `(whole ${whole.calories} kcal, per slice ${quarter.calories} kcal)`);
}

// 5. Changing the serving count does not touch the stored totals.
{
  const total = totalForRecipe([ing('butter', forGrams(BUTTER_100G, 100))]).total;
  const before = total.calories;
  perServing(total, 8);
  perServing(total, 2);
  check('5. dividing for display leaves the totals untouched',
    total.calories === before, `(${total.calories} kcal still)`);
}

// 6. Nonsense serving counts cannot produce Infinity or NaN on screen.
{
  const total = totalForRecipe([ing('butter', forGrams(BUTTER_100G, 100))]).total;
  const zero = perServing(total, 0);
  const neg = perServing(total, -3);
  const nan = perServing(total, NaN as number);
  check('6. zero, negative and NaN servings fall back to one',
    zero.calories === total.calories &&
      neg.calories === total.calories &&
      nan.calories === total.calories &&
      Number.isFinite(zero.calories));
}

// 7. A fractional serving count is floored rather than producing 2.5 servings.
{
  const total = totalForRecipe([ing('butter', forGrams(BUTTER_100G, 100))]).total;
  check('7. 2.7 servings is treated as 2', perServing(total, 2.7).calories === total.calories / 2);
}

// 8. Display rounding: calories to 5, grams whole. No fake precision.
{
  const r = roundForDisplay({
    calories: 358.5, protein_g: 0.425, carbs_g: 0.03, fat_g: 40.5,
    fiber_g: 0, sugar_g: 0.03, sodium_mg: 5.5,
  });
  check('8. rounded for display without inventing precision',
    r.calories === 360 && r.protein_g === 0 && r.fat_g === 41 && r.sodium_mg === 5,
    JSON.stringify(r));
}

// 9. An empty recipe totals zero and says nothing was counted.
{
  const { total, counted, missing } = totalForRecipe([]);
  check('9. an empty recipe is zero, not NaN',
    counted === 0 && missing.length === 0 && total.calories === 0);
}

// 10. Adding is commutative and does not mutate its inputs.
{
  const a = forGrams(BUTTER_100G, 100)!;
  const b = forGrams(BUTTER_100G, 50)!;
  const aBefore = a.calories;
  const sum1 = addNutrition(a, b);
  const sum2 = addNutrition(b, a);
  check('10. adding is order-independent and non-mutating',
    Math.abs(sum1.calories - sum2.calories) < 1e-9 && a.calories === aBefore);
}

// 11. The labels the user actually reads.
{
  check('11. serving labels read correctly',
    servingsLabel(1) === 'Serves 1' &&
      servingsLabel(4) === 'Serves 4' &&
      servingFractionLabel(1) === 'the whole recipe' &&
      servingFractionLabel(4) === '1/4 of the recipe',
    `("${servingFractionLabel(4)}")`);
}

// 12. Every field divides, not just calories — a bug that would look right.
{
  const total = totalForRecipe([ing('butter', forGrams(BUTTER_100G, 400))]).total;
  const each = perServing(total, 4);
  const ok = (Object.keys(EMPTY_NUTRITION) as (keyof Nutrition)[]).every(
    (k) => Math.abs(each[k] - total[k] / 4) < 1e-9,
  );
  check('12. every macro divides by servings, not only calories', ok);
}

console.log('');
console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
