/**
 * Pinch-to-zoom math, kept free of React so it can be unit tested.
 *
 * The photo is drawn as translate(t) then scale(s) around its own center, so a
 * point q (measured from the photo's center, unzoomed) ends up on screen at
 * center + t + s * q. Keeping the point you first pinched under your fingers
 * is then just solving that for t.
 */

export type Point = { x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
/** How far past the limits the photo can be stretched, like a rubber band. */
export const UNDER_ROOM = 0.25;
export const OVER_ROOM = 1;

/**
 * Past a limit the zoom keeps following your fingers but with more and more
 * resistance, approaching (never reaching) limit ± room. Feels elastic
 * instead of hitting a wall; the photo springs back to the limit on release.
 */
export function rubberBand(raw: number): number {
  const ease = (past: number, room: number) => room * (1 - 1 / (1 + past / room));
  if (raw < MIN_SCALE) return MIN_SCALE - ease(MIN_SCALE - raw, UNDER_ROOM);
  if (raw > MAX_SCALE) return MAX_SCALE + ease(raw - MAX_SCALE, OVER_ROOM);
  return raw;
}

const mid = (ps: Point[]): Point =>
  ps.length >= 2
    ? { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 }
    : ps[0];

const spread = (ps: Point[]): number =>
  ps.length >= 2 ? Math.hypot(ps[1].x - ps[0].x, ps[1].y - ps[0].y) : 0;

export function pinchTransform({
  center,
  start,
  now,
  baseScale,
  baseT,
}: {
  /** The photo's unzoomed center, in screen coordinates. */
  center: Point;
  /** Finger positions when this stretch of the gesture began. */
  start: Point[];
  /** Finger positions now (same count as `start`). */
  now: Point[];
  /** Zoom and offset at the moment `start` was taken. */
  baseScale: number;
  baseT: Point;
}): { scale: number; t: Point } {
  const d0 = spread(start);
  const d = spread(now);
  // Two fingers set the zoom; one finger just drags at the current zoom.
  const raw = d0 > 0 && d > 0 ? baseScale * (d / d0) : baseScale;
  const scale = rubberBand(raw);

  const p0 = mid(start);
  const p = mid(now);
  // The photo point that was under the fingers at the start…
  const q = {
    x: (p0.x - center.x - baseT.x) / baseScale,
    y: (p0.y - center.y - baseT.y) / baseScale,
  };
  // …stays under them now.
  return {
    scale,
    t: { x: p.x - center.x - scale * q.x, y: p.y - center.y - scale * q.y },
  };
}
