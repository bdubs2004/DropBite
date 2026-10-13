// Checks that an upload really is a JPEG photo, and returns a cleaned copy.
//
// The Content-Type header and the file name are whatever the client says, so
// neither is trusted: this reads the bytes. Shared by the upload-photo edge
// function and its tests (plain TypeScript, no Deno APIs).
//
// What "cleaned" means:
//   * Metadata segments are dropped: EXIF (which carries GPS location and the
//     camera serial), XMP, comments, and any vendor APP segment. The colour
//     profile (ICC) and the two segments decoders need (JFIF, Adobe) stay.
//   * Anything after the end-of-image marker is cut off, so a file can't
//     smuggle a second format (a zip, a script) after a real picture.
//   * Only the markers a normal photo uses are accepted before the image
//     data. Anything else is refused rather than passed through.

/** Same cap as the storage buckets. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** Same bounds as posts.photo_width / photo_height. */
export const MAX_PHOTO_SIDE = 10000;

export type JpegResult =
  | { ok: true; bytes: Uint8Array; width: number; height: number }
  | { ok: false; reason: string };

const ICC = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]; // "ICC_PROFILE\0"

function startsWith(b: Uint8Array, at: number, sig: number[]): boolean {
  if (at + sig.length > b.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}

/** Start-of-frame markers: they carry the picture's size. */
function isSof(m: number): boolean {
  return (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf);
}

export function cleanJpeg(input: Uint8Array): JpegResult {
  if (input.length > MAX_PHOTO_BYTES) return { ok: false, reason: 'too_large' };
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    return { ok: false, reason: 'not_a_jpeg' };
  }

  const keep: Uint8Array[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let pos = 2;

  for (;;) {
    if (pos + 4 > input.length || input[pos] !== 0xff) return { ok: false, reason: 'not_a_jpeg' };
    // Fill bytes (extra 0xFF) are allowed before a marker.
    while (pos + 1 < input.length && input[pos + 1] === 0xff) pos++;
    const marker = input[pos + 1];
    if (pos + 4 > input.length) return { ok: false, reason: 'not_a_jpeg' };
    const len = (input[pos + 2] << 8) | input[pos + 3];
    const end = pos + 2 + len;
    if (len < 2 || end > input.length) return { ok: false, reason: 'not_a_jpeg' };
    const segment = input.subarray(pos, end);

    if (marker === 0xda) {
      // Start of scan: compressed image data follows. Walk it the way a
      // decoder does, forwards, to the first real end-of-image marker; inside
      // the data 0xFF is always followed by 0x00 (stuffing) or a restart
      // marker. A progressive JPEG has more tables and scans in between.
      if (!width || !height) return { ok: false, reason: 'not_a_jpeg' };
      let i = end;
      let eoi = -1;
      while (i + 1 < input.length) {
        if (input[i] !== 0xff) {
          i++;
          continue;
        }
        const next = input[i + 1];
        if (next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7)) {
          i += next === 0xff ? 1 : 2;
          continue;
        }
        if (next === 0xd9) {
          eoi = i;
          break;
        }
        // Another segment between scans (progressive): only these belong there.
        if (next !== 0xc4 && next !== 0xda && next !== 0xdb && next !== 0xdd) {
          return { ok: false, reason: 'not_a_jpeg' };
        }
        if (i + 4 > input.length) return { ok: false, reason: 'not_a_jpeg' };
        const segLen = (input[i + 2] << 8) | input[i + 3];
        if (segLen < 2 || i + 2 + segLen > input.length) return { ok: false, reason: 'not_a_jpeg' };
        i += 2 + segLen;
      }
      if (eoi < 0) return { ok: false, reason: 'not_a_jpeg' };
      keep.push(input.subarray(pos, eoi + 2));
      break;
    }

    if (marker === 0xe0) {
      keep.push(segment); // JFIF
    } else if (marker === 0xee) {
      keep.push(segment); // Adobe: tells the decoder how the colours are stored
    } else if (marker === 0xe2 && startsWith(input, pos + 4, ICC)) {
      keep.push(segment); // colour profile; no personal data
    } else if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
      // EXIF / XMP / other APP segments and comments: dropped.
    } else if (isSof(marker)) {
      if (len < 8) return { ok: false, reason: 'not_a_jpeg' };
      height = (input[pos + 5] << 8) | input[pos + 6];
      width = (input[pos + 7] << 8) | input[pos + 8];
      if (!width || !height || width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE) {
        return { ok: false, reason: 'bad_size' };
      }
      keep.push(segment);
    } else if (marker === 0xdb || marker === 0xc4 || marker === 0xdd || marker === 0xcc) {
      keep.push(segment); // quantisation / Huffman tables, restart interval
    } else {
      return { ok: false, reason: 'not_a_jpeg' };
    }
    pos = end;
  }

  const total = keep.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of keep) {
    out.set(part, at);
    at += part.length;
  }
  return { ok: true, bytes: out, width, height };
}
