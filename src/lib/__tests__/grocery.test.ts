// The grocery list (src/lib/grocery.ts).
import { aisleOf, buildGroceryList, groceryText, itemKey, normalUnit, parseQuantity } from '../grocery';

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — got: ${JSON.stringify(got)}`}`);
};

check('whole numbers', parseQuantity('2') === 2);
check('fractions', parseQuantity('1/2') === 0.5 && parseQuantity('1 1/2') === 1.5, parseQuantity('1 1/2'));
check('unicode fractions', parseQuantity('½') === 0.5 && parseQuantity('1½') === 1.5, parseQuantity('1½'));
check('words are not amounts', parseQuantity('a pinch') === null && parseQuantity('') === null && parseQuantity('to taste') === null);
check('units read the same however they are written', normalUnit('Tablespoons') === 'tbsp' && normalUnit('lbs') === 'lb' && normalUnit('T') === 'tbsp' && normalUnit('t') === 'tsp' && normalUnit('cups') === 'cup');
check('the same thing is the same key', itemKey('Tomatoes') === itemKey('tomato') && itemKey('Ground Beef') === 'ground beef' && itemKey('berries') === 'berry', itemKey('Tomatoes'));
check('notes in brackets are dropped', itemKey('onion (diced)') === 'onion');
check('aisles', aisleOf('ground beef') === 'Meat and seafood' && aisleOf('egg') === 'Dairy and eggs' && aisleOf('tortilla') === 'Bakery' && aisleOf('onion') === 'Produce' && aisleOf('flour') === 'Pantry', [aisleOf('ground beef'), aisleOf('egg')]);
check('tricky aisles', aisleOf('cornstarch') === 'Pantry' && aisleOf('frozen pea') === 'Frozen' && aisleOf('black pepper') === 'Pantry' && aisleOf('cream cheese') === 'Dairy and eggs' && aisleOf('bell pepper') === 'Produce', [aisleOf('cornstarch'), aisleOf('black pepper'), aisleOf('bell pepper')]);
check('unknown things go in Other', aisleOf('paper towel') === 'Other');
check('dough is bakery', aisleOf('pizza dough') === 'Bakery');

const list = buildGroceryList([
  { meal: 'Tacos', ingredients: [
    { item: 'ground beef', quantity: '1', unit: 'lb' },
    { item: 'Tortillas', quantity: '8', unit: '' },
    { item: 'cheese', quantity: '1', unit: 'cup' },
    { item: 'salt', quantity: 'a pinch', unit: '' },
  ] },
  { meal: 'Chili', ingredients: [
    { item: 'Ground beef', quantity: '1 1/2', unit: 'lbs' },
    { item: 'cheese', quantity: '2', unit: 'tbsp' },
    { item: 'onion', quantity: '1', unit: '' },
    { item: '', quantity: '2', unit: 'cups' },
  ] },
]);
const beef = list.find((l) => l.key === 'ground beef');
check('the same ingredient from two meals is one line', !!beef && list.filter((l) => l.key === 'ground beef').length === 1, list.map((l) => l.key));
check('amounts in the same unit add up', beef?.amount === '2 1/2 lb', beef?.amount);
check('and it says which meals', JSON.stringify(beef?.meals) === '["Tacos","Chili"]', beef?.meals);
check('different units are listed together', list.find((l) => l.key === 'cheese')?.amount === '1 cup + 2 tbsp', list.find((l) => l.key === 'cheese')?.amount);
check('countable units read as plurals', buildGroceryList([{ meal: 'x', ingredients: [{ item: 'garlic', quantity: '3', unit: 'cloves' }] }])[0].amount === '3 cloves');
check('words are kept as written', list.find((l) => l.key === 'salt')?.amount === 'a pinch');
check('blank ingredients are skipped', list.every((l) => l.key.length > 0) && list.length === 5, list.length);
check('a plain count has no unit', list.find((l) => l.key === 'tortilla')?.amount === '8');
check('sorted the way a store is laid out', list[0].aisle === 'Produce' && list[list.length - 1].aisle !== 'Produce', list.map((l) => l.aisle));
check('as text, only what is left to buy', groceryText([{ name: 'Milk', amount: '1 gallon', done: false }, { name: 'Eggs', amount: '', done: true }], 'Groceries') === 'Groceries\n- Milk (1 gallon)');

console.log(failed ? `\n${failed} grocery check(s) failed` : '\nAll grocery checks passed');
if (failed) process.exit(1);
