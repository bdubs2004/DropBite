/**
 * Hashtags: the picker's rules, search, and the app's list matching the
 * database's (migration 0039).
 *
 * Run with: npm run test:hashtags
 */
import {
  ALL_HASHTAGS,
  cleanHashtags,
  hashtagsForSearch,
  HASHTAG_GROUPS,
  MAX_HASHTAGS,
  normalizeHashtag,
  SEARCH_EXAMPLES,
  toggleHashtag,
} from '../hashtags';

let failures = 0;
function check(label: string, pass: boolean, got?: unknown) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${got !== undefined ? `  — ${JSON.stringify(got)}` : ''}`);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The list itself.
check('every tag is lowercase letters and numbers, 2 to 30 long', ALL_HASHTAGS.every((t) => /^[a-z0-9]{2,30}$/.test(t)));
check('no tag is listed twice', new Set(ALL_HASHTAGS).size === ALL_HASHTAGS.length);
check('the search bar only suggests real tags', SEARCH_EXAMPLES.every((t) => ALL_HASHTAGS.includes(t)));
check('the examples the owner asked for are there', ['healthy', 'expensive', 'budget', 'mediterranean', 'chinese'].every((t) => ALL_HASHTAGS.includes(t)));

// The database holds the same list, in the same groups and order.
// Run from the repository root (npm run test:hashtags). Node's own modules,
// loaded so the app's type check doesn't need Node's types.
const fs = require('fs');
for (const file of ['supabase/migrations/0039_hashtags.sql', 'supabase/schema.sql']) {
  const sql: string = fs.readFileSync(file, 'utf8');
  const rows = [...sql.matchAll(/^\s*\('([a-z0-9]+)', '([a-z]+)', (\d+)\)/gm)].map((m: RegExpMatchArray) => [m[1], m[2], Number(m[3])]);
  const want: [string, string, number][] = [];
  let pos = 0;
  for (const g of HASHTAG_GROUPS) for (const t of g.tags) want.push([t, g.title.toLowerCase(), ++pos]);
  check(`${file} has the same ${want.length} tags as the app`, same(rows, want), rows.length);
  check(`${file} allows the same number per post`, sql.includes(`cardinality(hashtags) <= ${MAX_HASHTAGS}`) && sql.includes(`> ${MAX_HASHTAGS} then`));
}

// Tidying what a post carries.
check('known tags kept in order', same(cleanHashtags(['mexican', 'budget']), ['mexican', 'budget']));
check('unknown tags and repeats dropped', same(cleanHashtags(['mexican', 'freecrypto', 'mexican', 7, null]), ['mexican']));
check('at most 5', cleanHashtags(ALL_HASHTAGS).length === MAX_HASHTAGS);
check('not a list at all means none', same(cleanHashtags(null), []) && same(cleanHashtags('mexican'), []));

// Picking.
check('tap to add', same(toggleHashtag([], 'vegan'), ['vegan']));
check('tap again to remove', same(toggleHashtag(['vegan', 'keto'], 'vegan'), ['keto']));
const five = ALL_HASHTAGS.slice(0, 5);
check('a sixth is refused', same(toggleHashtag(five, 'vegan'), five));
check('a tag off the list is refused', same(toggleHashtag([], 'freecrypto'), []));

// Typing.
check('#Middle Eastern becomes middleeastern', normalizeHashtag('#Middle Eastern') === 'middleeastern', normalizeHashtag('#Middle Eastern'));

// Search.
check('"#chin" finds tags starting with chin', same(hashtagsForSearch('#chin'), { tags: ['chinese'], only: true }), hashtagsForSearch('#chin'));
check('"#" alone matches nothing yet', hashtagsForSearch('#').tags.length === 0 && hashtagsForSearch('#').only);
check('"chinese" also finds #chinese', same(hashtagsForSearch('chinese'), { tags: ['chinese'], only: false }));
check('"Chinese " with capitals and spaces too', same(hashtagsForSearch(' Chinese '), { tags: ['chinese'], only: false }));
check('"chicken" is not a tag', same(hashtagsForSearch('chicken'), { tags: [], only: false }));
check('"#zzz" matches no tag', same(hashtagsForSearch('#zzz'), { tags: [], only: true }));

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll hashtag checks passed');
