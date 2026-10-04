/**
 * Collection names: tidied once here so the app, demo mode and the database
 * all agree on what counts as the same name.
 */

export const COLLECTION_NAME_MAX = 40;

/** Trim and collapse runs of spaces. "  Crockpot   meals " -> "Crockpot meals". */
export function tidyCollectionName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/**
 * Why a name can't be used, or null if it's fine. `existing` is the person's
 * other collection names; matching ignores case, so "Desserts" and "desserts"
 * can't both exist.
 */
export function collectionNameProblem(name: string, existing: string[] = []): string | null {
  const tidy = tidyCollectionName(name);
  if (!tidy) return 'Give your collection a name';
  if (tidy.length > COLLECTION_NAME_MAX) {
    return `Keep it under ${COLLECTION_NAME_MAX} characters`;
  }
  const lower = tidy.toLowerCase();
  if (existing.some((n) => tidyCollectionName(n).toLowerCase() === lower)) {
    return `You already have a collection called ${tidy}`;
  }
  return null;
}
