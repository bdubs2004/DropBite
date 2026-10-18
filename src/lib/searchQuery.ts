/**
 * Understanding what someone typed into dish search.
 *
 * Search is meant to feel smart: "budget meals" means dishes marked $,
 * "cheap mexican" means $ dishes tagged #mexican, "breakfast" means breakfast
 * posts, "healthy chicken bowl" means
 * dishes tagged #healthy that mention "chicken bowl". The words that name a
 * price or a hashtag become filters; filler like "meals" or "food" goes; what's
 * left is matched against the description, recipe title and ingredients.
 *
 * The filters picked by hand on the Search screen (Price, Hashtags) combine
 * with all of this: see combineSearch.
 */
import { ALL_HASHTAGS, isHashtag, normalizeHashtag } from './hashtags';
import { PriceLevel } from './price';
import { MealSlot } from '../types';

export type ParsedSearch = {
  /** Words left to match in the text (description, recipe title, ingredients). */
  text: string;
  /** Hashtags every result must carry. */
  tags: string[];
  /**
   * "#me" while still typing: results carry at least one tag starting with
   * it. Empty when not typing a partial tag.
   */
  tagPrefix: string[];
  /**
   * A single bare word that is a tag ("chinese"): matched as that tag OR in
   * the text, so a post that says "Chinese takeout" without the tag still
   * turns up.
   */
  softTag: string | null;
  /** Price levels a result can have (any of them). */
  prices: PriceLevel[];
  /** Meal slots a result can be in (any of them). */
  slots: MealSlot[];
};

const CHEAP = ['budget', 'cheap', 'cheapeats', 'inexpensive', 'affordable', 'lowcost', 'frugal', 'broke', 'thrifty', 'economical'];
const MID = ['moderate', 'midrange', 'midpriced'];
const PRICEY = ['expensive', 'pricey', 'splurge', 'fancy', 'luxury', 'luxurious', 'bougie', 'upscale', 'gourmet', 'highend'];

// Two-word ways of saying a price, joined before reading word by word.
const PHRASES: [RegExp, string][] = [
  [/\bcheap\s+eats\b/g, 'cheap'],
  [/\blow[\s-]+cost\b/g, 'lowcost'],
  [/\bhigh[\s-]+end\b/g, 'highend'],
  [/\bmid[\s-]+range\b/g, 'midrange'],
  [/\bmid[\s-]+priced\b/g, 'midpriced'],
  [/\bon\s+a\s+budget\b/g, 'budget'],
  [/\bmiddle\s+eastern\b/g, 'middleeastern'],
  [/\bsoul\s+food\b/g, 'soulfood'],
  [/\bcomfort\s+food\b/g, 'comfortfood'],
  [/\bstreet\s+food\b/g, 'streetfood'],
  [/\bmeal\s+prep\b/g, 'mealprep'],
  [/\bdate\s+night\b/g, 'datenight'],
  [/\blate\s+night\b/g, 'latenight'],
  [/\bgame\s+day\b/g, 'gameday'],
  [/\bfamily\s+dinner\b/g, 'familydinner'],
  [/\bsweet\s+tooth\b/g, 'sweettooth'],
  [/\bair\s+fryer\b/g, 'airfryer'],
  [/\bslow\s+cooker\b/g, 'slowcooker'],
  [/\bone\s+pot\b/g, 'onepot'],
  [/\bhigh\s+protein\b/g, 'highprotein'],
  [/\blow\s+carb\b/g, 'lowcarb'],
  [/\bgluten\s+free\b/g, 'glutenfree'],
  [/\bdairy\s+free\b/g, 'dairyfree'],
  [/\bquick\s+and\s+easy\b/g, 'quickandeasy'],
  [/\btake\s*out\b/g, 'takeout'],
];

const NO_TAG = '-';

const SLOTS: Record<string, MealSlot> = {
  breakfast: 'breakfast',
  breakfasts: 'breakfast',
  lunch: 'lunch',
  lunches: 'lunch',
  dinner: 'dinner',
  dinners: 'dinner',
  supper: 'dinner',
  snack: 'snack',
  snacks: 'snack',
};

// Words that say nothing about which dish ("budget meals", "cheap eats").
const FILLER = new Set(['meal', 'meals', 'food', 'foods', 'dish', 'dishes', 'eats', 'recipe', 'recipes', 'idea', 'ideas', 'options', 'stuff']);
// Left on their own, these aren't worth searching for.
const STOP = new Set(['a', 'an', 'the', 'on', 'for', 'and', 'or', 'with', 'some', 'in', 'of', 'to', 'under', 'that', 'is', 'are', 'me', 'my']);

/** Read a typed search into text plus filters. */
export function parseSearch(raw: string): ParsedSearch {
  let q = raw.toLowerCase().trim();
  for (const [re, to] of PHRASES) q = q.replace(re, to);

  const tags: string[] = [];
  const bareTags: string[] = [];
  let tagPrefix: string[] = [];
  const prices = new Set<PriceLevel>();
  const slots = new Set<MealSlot>();
  const rest: string[] = [];

  for (const word of q.split(/\s+/).filter(Boolean)) {
    if (/^\$+$/.test(word) && word.length <= 3) {
      prices.add(word.length as PriceLevel);
      continue;
    }
    if (word.startsWith('#')) {
      const t = normalizeHashtag(word);
      if (!t) continue;
      if (isHashtag(t)) tags.push(t);
      else {
        // Still typing: every tag that starts that way. When none does, a
        // placeholder that no post carries, so nothing matches.
        const starts = ALL_HASHTAGS.filter((x) => x.startsWith(t));
        tagPrefix = starts.length ? starts : [NO_TAG];
      }
      continue;
    }
    const w = word.replace(/[^\p{L}\p{N}'-]/gu, '');
    if (!w) continue;
    const key = w.replace(/[^a-z0-9]/g, '');
    if (CHEAP.includes(key)) prices.add(1);
    else if (MID.includes(key)) prices.add(2);
    else if (PRICEY.includes(key)) prices.add(3);
    else if (SLOTS[key]) slots.add(SLOTS[key]);
    else if (isHashtag(key)) bareTags.push(key);
    else if (!FILLER.has(key)) rest.push(w);
  }

  const leftover = rest.every((w) => STOP.has(w)) ? [] : rest;
  const uniq = (xs: string[]) => [...new Set(xs)];
  // Just one bare tag word and nothing else: tag OR text.
  const soft =
    bareTags.length === 1 &&
    !leftover.length &&
    !tags.length &&
    !tagPrefix.length &&
    !prices.size &&
    !slots.size;
  return {
    text: leftover.join(' '),
    tags: uniq(soft ? tags : [...tags, ...bareTags]),
    tagPrefix,
    softTag: soft ? bareTags[0] : null,
    prices: [...prices].sort(),
    slots: [...slots],
  };
}

export type SearchFilters = { tags?: string[]; prices?: PriceLevel[] };

/**
 * What was typed, plus the filters picked by hand. Hashtags add up (a result
 * needs all of them); a price picked by hand replaces one read from the words.
 */
export function combineSearch(query: string, filters: SearchFilters = {}): ParsedSearch {
  const p = parseSearch(query);
  return {
    ...p,
    tags: [...new Set([...p.tags, ...(filters.tags ?? [])])],
    prices: filters.prices?.length ? [...filters.prices].sort() : p.prices,
  };
}

/** Is there anything to search for at all? */
export function hasSearch(s: ParsedSearch): boolean {
  return Boolean(
    s.text || s.softTag || s.tags.length || s.tagPrefix.length || s.prices.length || s.slots.length,
  );
}

/**
 * Does one post match? The demo backend searches with this; the real one
 * asks the database the same questions (supabaseService.searchPosts).
 */
export function postMatches(
  post: {
    blurb: string;
    meal_slot?: MealSlot;
    hashtags?: string[] | null;
    price_level?: number | null;
    recipeTitle?: string | null;
    ingredients?: string[];
  },
  s: ParsedSearch,
): boolean {
  const tags = post.hashtags ?? [];
  if (s.tags.some((t) => !tags.includes(t))) return false;
  if (s.tagPrefix.length && !tags.some((t) => s.tagPrefix.includes(t))) return false;
  if (s.prices.length && !s.prices.includes(post.price_level as PriceLevel)) return false;
  if (s.slots.length && !s.slots.includes(post.meal_slot as MealSlot)) return false;
  const inText = (term: string) =>
    post.blurb.toLowerCase().includes(term) ||
    (post.recipeTitle ?? '').toLowerCase().includes(term) ||
    (post.ingredients ?? []).some((i) => i.toLowerCase().includes(term));
  if (s.softTag) return tags.includes(s.softTag) || inText(s.softTag);
  if (s.text) return inText(s.text);
  return true;
}
