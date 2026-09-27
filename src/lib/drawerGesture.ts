/**
 * Pure drag math for the "Your stuff" side drawer, kept out of the component
 * so it can be unit-tested without a device. The drawer sits on the right and
 * closes by dragging right; `dx` is the horizontal travel in px (positive =
 * toward closed), `vx` the release velocity.
 */

/** Let go past this fraction of the panel's width and it closes. */
export const DRAWER_DISMISS_FRACTION = 0.5;
/** ...or flick faster than this, at any distance. */
export const DRAWER_DISMISS_VELOCITY = 0.5;

/** While dragging: follow the finger toward closed, never past fully-open. */
export function drawerTranslate(dx: number): number {
  return Math.max(0, dx);
}

/** Is this drag horizontal enough to treat as a drawer slide (vs a scroll)? */
export function isHorizontalDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy);
}

/** On release: close if dragged past halfway or flicked, else snap back open. */
export function shouldCloseDrawer(dx: number, vx: number, panelWidth: number): boolean {
  return dx > panelWidth * DRAWER_DISMISS_FRACTION || vx > DRAWER_DISMISS_VELOCITY;
}
