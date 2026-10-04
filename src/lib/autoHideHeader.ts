/**
 * When an auto-hiding header should hide or come back, from scroll positions.
 *
 * Distance is counted in the direction you're currently scrolling, so a small
 * wobble doesn't flicker it: keep scrolling down past `hideAfter` and it hides,
 * scroll back up `showAfter` and it returns. At (or above) the very top it is
 * always shown.
 */

export type HeaderScrollState = { lastY: number; travel: number; hidden: boolean };

export const HIDE_AFTER = 24;
export const SHOW_AFTER = 16;

export function nextHeaderState(
  prev: HeaderScrollState,
  y: number,
  { topZone = 0 }: { topZone?: number } = {},
): HeaderScrollState {
  // Pull-to-refresh overscroll and the very top: always visible.
  if (y <= topZone) return { lastY: y, travel: 0, hidden: false };
  const dy = y - prev.lastY;
  if (dy === 0) return prev;
  // Reset the count whenever the direction flips.
  const sameWay = (dy > 0 && prev.travel >= 0) || (dy < 0 && prev.travel <= 0);
  const travel = sameWay ? prev.travel + dy : dy;
  let hidden = prev.hidden;
  if (!hidden && travel >= HIDE_AFTER) hidden = true;
  else if (hidden && travel <= -SHOW_AFTER) hidden = false;
  return { lastY: y, travel, hidden };
}
