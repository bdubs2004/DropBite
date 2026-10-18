/**
 * Smart dish search: price words and hashtags become filters, filler goes.
 *
 * Run with: npm run test:search
 */
import { combineSearch, hasSearch, parseSearch, postMatches } from '../searchQuery';

let failures = 0;
function check(label: string, pass: boolean, got?: unknown) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${got !== undefined ? `  — ${JSON.stringify(got)}` : ''}`);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const is = (q: string, want: Partial<ReturnType<typeof parseSearch>>) => {
  const got = parseSearch(q);
  const full = { text: '', tags: [], tagPrefix: [], softTag: null, prices: [], slots: [], ...want };
  check(`"${q}"`, same(got, full), got);
};

// Prices from words.
is('budget meals', { prices: [1] });
is('cheap eats', { prices: [1] });
is('on a budget', { prices: [1] });
is('affordable dinner ideas', { prices: [1], slots: ['dinner'] });
is('expensive', { prices: [3] });
is('fancy date night', { prices: [3], tags: ['datenight'] });
is('$$', { prices: [2] });
is('$ or $$$', { prices: [1, 3] });

// Hashtags from words.
is('chinese', { softTag: 'chinese' });
is('Chinese food', { softTag: 'chinese' });
is('healthy mexican', { tags: ['healthy', 'mexican'] });
is('cheap mexican', { prices: [1], tags: ['mexican'] });
is('budget vegan meals', { prices: [1], tags: ['vegan'] });
is('healthy chicken bowl', { tags: ['healthy'], text: 'chicken bowl' });
is('middle eastern', { softTag: 'middleeastern' });
is('#mexican', { tags: ['mexican'] });
is('#me', { tagPrefix: ['mediterranean', 'mexican', 'mealprep'] });
is('#zzz', { tagPrefix: ['-'] });

// Meal slots from words.
is('breakfast', { slots: ['breakfast'] });
is('cheap vegan lunch', { prices: [1], tags: ['vegan'], slots: ['lunch'] });
is('pancake breakfast', { text: 'pancake', slots: ['breakfast'] });

// Plain text stays text.
is('chicken thing with garlic', { text: 'chicken thing with garlic' });
is('gochujang', { text: 'gochujang' });
is('meals', {});
is('the', {});

// Filters picked by hand.
const c = combineSearch('budget mexican', { tags: ['spicy'], prices: [2] });
check('picked hashtags add to typed ones', same(c.tags, ['mexican', 'spicy']), c.tags);
check('a picked price replaces one read from the words', same(c.prices, [2]), c.prices);
check('filters alone are a search', hasSearch(combineSearch('', { prices: [1] })));
check('nothing at all is not', !hasSearch(combineSearch('   ')));

// Matching one post.
const taco = { meal_slot: 'dinner', blurb: 'Al pastor from the truck', hashtags: ['mexican', 'streetfood'], price_level: 1, recipeTitle: 'Tacos', ingredients: ['pork', 'pineapple'] };
const steak = { blurb: 'Anniversary steak', hashtags: ['datenight'], price_level: 3, recipeTitle: null, ingredients: [] };
const takeout = { blurb: 'Chinese takeout, no tag', hashtags: [], price_level: null };
const m = (q: string, post: any, f = {}) => postMatches(post, combineSearch(q, f));
check('budget meals finds the $ taco, not the $$$ steak', m('budget meals', taco) && !m('budget meals', steak));
check('cheap mexican finds the taco', m('cheap mexican', taco));
check('expensive mexican finds nothing', !m('expensive mexican', taco) && !m('expensive mexican', steak));
check('"chinese" finds an untagged post that says Chinese', m('chinese', takeout));
check('"pineapple" finds it by ingredient', m('pineapple', taco));
check('a post with no price is left out once a price is asked for', !m('budget', takeout));
check('Price filter by hand: $$$ finds the steak', m('', steak, { prices: [3] }) && !m('', taco, { prices: [3] }));
check('Hashtag filter by hand plus text', m('pastor', taco, { tags: ['mexican'] }) && !m('pastor', taco, { tags: ['vegan'] }));
check('"#me" finds a #mexican post', m('#me', taco));
check('"cheap dinner" finds the taco dinner, "cheap lunch" doesn\'t', m('cheap dinner', taco) && !m('cheap lunch', taco));

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll search checks passed');
