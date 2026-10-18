/**
 * Hashtags: an optional label or two on a post (#mexican, #vegan, #healthy)
 * that make dishes easy to find in Search.
 *
 * What a dish cost is not a hashtag: posts carry a price level instead
 * ($ / $$ / $$$, src/lib/price.ts), which Search filters on.
 *
 * People pick from this list rather than typing their own, like TikTok's
 * suggested tags: every tag is one people will actually search for, nobody
 * splits a tag three ways (#bbq, #BBQ, #barbecue), and nothing offensive can
 * end up printed under a post. The database holds the same list (migration
 * 0039) and refuses anything else; the hashtag test checks the two match.
 */

export type HashtagGroup = { title: string; tags: string[] };

/** The whole catalogue, in the order the picker shows it. */
export const HASHTAG_GROUPS: HashtagGroup[] = [
  {
    title: 'Cuisine',
    tags: [
      'american',
      'bbq',
      'cajun',
      'caribbean',
      'chinese',
      'french',
      'greek',
      'indian',
      'italian',
      'japanese',
      'korean',
      'mediterranean',
      'mexican',
      'middleeastern',
      'soulfood',
      'southern',
      'spanish',
      'thai',
      'vietnamese',
    ],
  },
  {
    title: 'Diet',
    tags: [
      'healthy',
      'highprotein',
      'lowcarb',
      'keto',
      'vegan',
      'vegetarian',
      'pescatarian',
      'glutenfree',
      'dairyfree',
    ],
  },
  {
    title: 'Cooking',
    tags: [
      'homemade',
      'takeout',
      'mealprep',
      'quickandeasy',
      'onepot',
      'airfryer',
      'slowcooker',
      'grilled',
      'baked',
      'streetfood',
    ],
  },
  {
    title: 'Vibe',
    tags: [
      'comfortfood',
      'spicy',
      'sweettooth',
      'dessert',
      'seafood',
      'brunch',
      'datenight',
      'latenight',
      'gameday',
      'familydinner',
      'leftovers',
    ],
  },
];

/** Most a post can carry. The database holds the same limit. */
export const MAX_HASHTAGS = 5;

export const ALL_HASHTAGS: string[] = HASHTAG_GROUPS.flatMap((g) => g.tags);
const KNOWN = new Set(ALL_HASHTAGS);

/** What the search bar cycles through before you type. */
export const SEARCH_EXAMPLES = [
  'chinese',
  'healthy',
  'bbq',
  'mediterranean',
  'comfortfood',
  'mexican',
  'mealprep',
  'datenight',
  'vegan',
  'spicy',
];

export function isHashtag(tag: string): boolean {
  return KNOWN.has(tag);
}

/**
 * Turn whatever was typed into the form tags are kept in: no '#', lowercase,
 * letters and numbers only ("#Middle Eastern" → "middleeastern").
 */
export function normalizeHashtag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);
}

/**
 * A post's tags, safe to draw: known tags only, no repeats, at most
 * MAX_HASHTAGS, in the order they were picked. Anything else (an older row, a
 * scripted client) is dropped rather than shown.
 */
export function cleanHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string' || !KNOWN.has(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length === MAX_HASHTAGS) break;
  }
  return out;
}

/** Add a tag if there's room, or take it off if it's already there. */
export function toggleHashtag(current: string[], tag: string): string[] {
  if (current.includes(tag)) return current.filter((t) => t !== tag);
  if (current.length >= MAX_HASHTAGS || !KNOWN.has(tag)) return current;
  return [...current, tag];
}
