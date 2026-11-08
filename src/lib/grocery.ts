import { Ingredient } from '../types';

/**
 * The grocery list: every ingredient on every recipe in a week's meal plan,
 * added up into one list you can shop from, grouped the way a store is laid
 * out. Pure functions, so the list is the same on every phone in a family.
 */

export type Aisle = 'Produce' | 'Meat and seafood' | 'Dairy and eggs' | 'Bakery' | 'Pantry' | 'Frozen' | 'Other';
export const AISLES: Aisle[] = ['Produce', 'Meat and seafood', 'Dairy and eggs', 'Bakery', 'Pantry', 'Frozen', 'Other'];

export interface GroceryLine {
  /** What the list is keyed on: lower case, singular ("ground beef", "tomato"). */
  key: string;
  /** How to show it ("Ground beef"). */
  name: string;
  /** "2 lb", "3 cups + 1 tbsp", or "" when no amounts were given. */
  amount: string;
  /** Which meals it's for. */
  meals: string[];
  aisle: Aisle;
  /** Added by hand, not from a recipe. */
  custom: boolean;
}

const UNICODE_FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

/** "1 1/2" → 1.5, "½" → 0.5, "2.5" → 2.5, "a pinch" → null. */
export function parseQuantity(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  let s = raw.trim();
  if (!s) return null;
  let total = 0;
  for (const [ch, v] of Object.entries(UNICODE_FRACTIONS)) {
    if (s.includes(ch)) {
      total += v;
      s = s.replace(ch, ' ').trim();
    }
  }
  if (!s) return total || null;
  const parts = s.split(/\s+/);
  for (const p of parts) {
    const frac = /^(\d+)\/(\d+)$/.exec(p);
    if (frac) {
      const d = Number(frac[2]);
      if (!d) return null;
      total += Number(frac[1]) / d;
    } else if (/^\d+(\.\d+)?$/.test(p)) {
      total += Number(p);
    } else {
      return null;
    }
  }
  return total > 0 ? total : null;
}

const UNIT_ALIASES: Record<string, string> = {
  tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', T: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', t: 'tsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', l: 'l', liter: 'l', liters: 'l',
  clove: 'clove', cloves: 'clove', can: 'can', cans: 'can', jar: 'jar', jars: 'jar',
  package: 'package', packages: 'package', pkg: 'package', bag: 'bag', bags: 'bag',
  slice: 'slice', slices: 'slice', bunch: 'bunch', bunches: 'bunch', stick: 'stick', sticks: 'stick',
  piece: '', pieces: '', whole: '', each: '', large: '', medium: '', small: '',
};
const COUNTABLE = new Set(['cup', 'clove', 'can', 'jar', 'package', 'bag', 'slice', 'bunch', 'stick']);

/** "Tablespoons" → "tbsp", "lbs" → "lb", "" → "". Unknown units stay as written (lower case). */
export function normalUnit(raw: string | null | undefined): string {
  const u = String(raw ?? '').trim().replace(/\.$/, '');
  if (!u) return '';
  if (u in UNIT_ALIASES) return UNIT_ALIASES[u];
  const low = u.toLowerCase();
  return low in UNIT_ALIASES ? UNIT_ALIASES[low] : low;
}

/** The last word made singular, the rough way: "tomatoes" → "tomato", "berries" → "berry". */
function singularWord(w: string): string {
  if (w.length <= 3 || /(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** What two ingredients have to share to be the same thing on the list. */
export function itemKey(item: string): string {
  const words = item
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  words[words.length - 1] = singularWord(words[words.length - 1]);
  return words.join(' ').slice(0, 80);
}

const AISLE_WORDS: [Aisle, string[]][] = [
  ['Frozen', ['frozen', 'ice cream']],
  ['Meat and seafood', ['beef', 'chicken', 'pork', 'turkey', 'bacon', 'sausage', 'steak', 'ham', 'lamb', 'salmon', 'shrimp', 'fish', 'tuna', 'cod', 'tilapia', 'brisket', 'roast', 'meatball', 'chorizo', 'pepperoni', 'crab', 'lobster', 'scallop']],
  ['Dairy and eggs', ['milk', 'cheese', 'butter', 'egg', 'yogurt', 'cream', 'sour cream', 'buttermilk', 'parmesan', 'mozzarella', 'cheddar', 'feta', 'ricotta', 'half and half']],
  ['Bakery', ['bread', 'bun', 'tortilla', 'bagel', 'roll', 'pita', 'naan', 'croissant', 'baguette', 'english muffin', 'dough', 'pizza crust', 'pie crust']],
  ['Produce', ['onion', 'garlic', 'tomato', 'potato', 'lettuce', 'spinach', 'carrot', 'celery', 'pepper', 'jalapeno', 'cucumber', 'zucchini', 'broccoli', 'cauliflower', 'mushroom', 'avocado', 'lemon', 'lime', 'orange', 'apple', 'banana', 'berry', 'strawberry', 'blueberry', 'grape', 'cilantro', 'parsley', 'basil', 'mint', 'ginger', 'scallion', 'green onion', 'kale', 'cabbage', 'corn', 'pea', 'bean sprout', 'squash', 'pumpkin', 'peach', 'pear', 'mango', 'pineapple', 'herb', 'shallot', 'leek', 'asparagus', 'arugula', 'radish', 'sweet potato', 'fruit', 'vegetable', 'salad']],
  ['Pantry', ['flour', 'sugar', 'salt', 'pepper', 'oil', 'vinegar', 'rice', 'pasta', 'noodle', 'spaghetti', 'macaroni', 'bean', 'lentil', 'broth', 'stock', 'sauce', 'ketchup', 'mustard', 'mayo', 'mayonnaise', 'honey', 'syrup', 'baking', 'yeast', 'vanilla', 'cinnamon', 'paprika', 'cumin', 'oregano', 'chili powder', 'seasoning', 'spice', 'oat', 'cereal', 'peanut butter', 'jam', 'chocolate', 'chip', 'cracker', 'nut', 'almond', 'walnut', 'coconut', 'soy', 'salsa', 'can', 'canned', 'tomato paste', 'cornstarch', 'breadcrumb', 'coffee', 'tea']],
];

/** Which part of the store: first match wins, in the order above (frozen peas are Frozen). */
export function aisleOf(key: string): Aisle {
  // Whole words or phrases only, so "corn" doesn't catch "cornstarch".
  const has = (w: string) => new RegExp(`(^|\\s)${w.replace(/ /g, '\\s')}(s|es)?(\\s|$)`).test(key);
  // A few that would otherwise land in the wrong place.
  if (has('black pepper') || has('ground pepper') || has('salt and pepper')) return 'Pantry';
  if (has('peanut butter')) return 'Pantry';
  if (has('cream cheese') || has('sour cream')) return 'Dairy and eggs';
  for (const [aisle, words] of AISLE_WORDS) if (words.some(has)) return aisle;
  return 'Other';
}

const round = (n: number) => {
  const r = Math.round(n * 100) / 100;
  // Show common fractions the way a cook writes them.
  const whole = Math.floor(r);
  const frac = r - whole;
  const f =
    Math.abs(frac - 0.5) < 0.01 ? '1/2' : Math.abs(frac - 0.25) < 0.01 ? '1/4' : Math.abs(frac - 0.75) < 0.01 ? '3/4'
      : Math.abs(frac - 1 / 3) < 0.01 ? '1/3' : Math.abs(frac - 2 / 3) < 0.01 ? '2/3' : null;
  if (frac < 0.01) return String(whole);
  if (f) return whole ? `${whole} ${f}` : f;
  return String(r);
};

function formatAmount(n: number, unit: string): string {
  const num = round(n);
  if (!unit) return num;
  const plural = n > 1 && COUNTABLE.has(unit) ? (unit === 'bunch' ? 'bunches' : unit + 's') : unit;
  return `${num} ${plural}`;
}

/** "ground beef" → "Ground beef". */
function displayName(item: string): string {
  const t = item.trim().replace(/\s+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** One recipe's worth of ingredients, and the meal they're for. */
export interface GrocerySource {
  meal: string;
  ingredients: Ingredient[];
}

/**
 * Add a week of recipes up into one list. The same ingredient from two meals
 * is one line: amounts in the same unit are summed ("1 lb + 1 lb" is "2 lb"),
 * different units are listed together ("2 cups + 1 tbsp"), and amounts that
 * aren't numbers ("a pinch") are kept as written.
 */
export function buildGroceryList(sources: GrocerySource[]): GroceryLine[] {
  const byKey = new Map<
    string,
    { name: string; sums: Map<string, number>; loose: string[]; meals: string[] }
  >();
  for (const src of sources) {
    for (const ing of src.ingredients) {
      const key = itemKey(ing.item ?? '');
      if (!key) continue;
      let line = byKey.get(key);
      if (!line) {
        line = { name: displayName(ing.item), sums: new Map(), loose: [], meals: [] };
        byKey.set(key, line);
      }
      if (src.meal && !line.meals.includes(src.meal)) line.meals.push(src.meal);
      const qty = parseQuantity(ing.quantity);
      const unit = normalUnit(ing.unit);
      if (qty !== null) {
        line.sums.set(unit, (line.sums.get(unit) ?? 0) + qty);
      } else {
        const written = [String(ing.quantity ?? '').trim(), String(ing.unit ?? '').trim()].filter(Boolean).join(' ');
        if (written && !line.loose.includes(written)) line.loose.push(written);
      }
    }
  }
  return [...byKey.entries()]
    .map(([key, l]) => ({
      key,
      name: l.name,
      amount: [...[...l.sums.entries()].map(([u, n]) => formatAmount(n, u)), ...l.loose].join(' + '),
      meals: l.meals,
      aisle: aisleOf(key),
      custom: false,
    }))
    .sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.name.localeCompare(b.name));
}

/** The list as plain text, for texting it to whoever is going to the store. */
export function groceryText(lines: { name: string; amount: string; done: boolean }[], title: string): string {
  const open = lines.filter((l) => !l.done);
  return [title, ...open.map((l) => `- ${l.name}${l.amount ? ` (${l.amount})` : ''}`)].join('\n');
}
