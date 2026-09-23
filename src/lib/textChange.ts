/**
 * Decide whether a description was changed *substantially* since a recipe card
 * was generated from it — enough that the card and its nutrition label are
 * probably wrong for the new text.
 *
 * A light word-overlap heuristic rather than a diff: it should fire on a
 * rewrite ("chicken with garlic" -> "beef stew with potatoes") but stay quiet
 * on a small addition or a typo fix ("...and a splash of cream"). We compare
 * the set of words and also flag a large change in overall length (e.g. the
 * user cleared most of it, or pasted a lot more).
 */
export function isSubstantialChange(before: string, after: string): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  const a = words(before);
  const b = words(after);
  if (a.length === 0 && b.length === 0) return false;
  // Went from nothing to something (or back) — treat as substantial.
  if (a.length === 0 || b.length === 0) return true;

  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  const union = new Set([...a, ...b]).size;
  const overlap = union === 0 ? 1 : shared / union; // 1 = identical vocabulary

  const lenRatio = Math.abs(a.length - b.length) / Math.max(a.length, b.length);

  // Less than half the vocabulary shared, or most of the length changed.
  return overlap < 0.5 || lenRatio > 0.6;
}
