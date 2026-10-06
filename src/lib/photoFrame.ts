/**
 * How tall to draw a photo for its width, so the whole picture shows.
 *
 * Photos keep their own shape, like Instagram: anything from a wide 1.91:1
 * landscape up to a 3:4 portrait (a full, uncropped phone photo) gets a frame
 * exactly its shape. Taller or wider than that (a 9:16 screenshot, a panorama),
 * the frame stops at the limit and the photo fits inside it rather than being
 * cut, so nothing is ever lost and one post can't take over the whole feed.
 *
 * Ratios here are height / width.
 */

/** Widest frame: 1.91:1 landscape. */
export const MIN_PHOTO_RATIO = 1 / 1.91;
/** Tallest frame: 3:4 portrait, a whole phone photo. */
export const MAX_PHOTO_RATIO = 4 / 3;
/** Until we know a photo's shape (older posts, still loading): 4:5. */
export const DEFAULT_PHOTO_RATIO = 5 / 4;

export type PhotoFrame = {
  /** Height / width of the frame to draw. */
  ratio: number;
  /** 'cover' when the frame matches the photo, 'contain' when clamped. */
  fit: 'cover' | 'contain';
};

/** The frame for a photo of this size, or the default if the size is unknown. */
export function photoFrame(width?: number | null, height?: number | null): PhotoFrame {
  if (!width || !height || width <= 0 || height <= 0) {
    return { ratio: DEFAULT_PHOTO_RATIO, fit: 'cover' };
  }
  const natural = height / width;
  const ratio = Math.min(MAX_PHOTO_RATIO, Math.max(MIN_PHOTO_RATIO, natural));
  // A hair of tolerance so rounding never flips a matching photo to 'contain'.
  return { ratio, fit: Math.abs(ratio - natural) < 0.005 ? 'cover' : 'contain' };
}

/**
 * The size to shrink a photo to so its longest side is at most `cap`, keeping
 * its shape. Never enlarges a small photo. Null means leave it as it is.
 */
export function fitWithin(
  width: number,
  height: number,
  cap: number,
): { width: number } | { height: number } | null {
  if (!width || !height || Math.max(width, height) <= cap) return null;
  return width >= height ? { width: cap } : { height: cap };
}
