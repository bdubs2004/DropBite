// Tests for cleanJpeg: real JPEGs pass (and come out clean), everything else
// is refused. Fixtures are real files made with ImageMagick; the attack files
// are built from them below. Run: npm run test:jpeg
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cleanJpeg, MAX_PHOTO_BYTES } from '../jpeg';

// npm runs this from the repo root.
const FIX = join(process.cwd(), 'supabase', 'functions', '_shared', 'test-fixtures');
const read = (name: string) => new Uint8Array(readFileSync(join(FIX, name)));
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const cat = (...parts: (Uint8Array | number[] | string)[]) =>
  new Uint8Array(
    Buffer.concat(
      parts.map((p) =>
        typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p as Uint8Array),
      ),
    ),
  );
/** A JPEG segment: marker + 2-byte length + payload. */
const segment = (marker: number, payload: string | Uint8Array) => {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'latin1') : Buffer.from(payload);
  const len = body.length + 2;
  return cat([0xff, marker, len >> 8, len & 0xff], body);
};

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ImageMagick, if present, confirms a cleaned file still decodes.
const tmp = mkdtempSync(join(tmpdir(), 'jpeg-test-'));
const decodes = (bytes: Uint8Array): boolean | null => {
  const f = join(tmp, `${Math.random().toString(36).slice(2)}.jpg`);
  writeFileSync(f, bytes);
  try {
    return /JPEG \d+x\d+/.test(execFileSync('identify', ['-regard-warnings', f]).toString());
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null; // no ImageMagick: skip that part
    return false;
  }
};
const decodeOk = (b: Uint8Array) => decodes(b) !== false;

const baseline = read('baseline.jpg');
const progressive = read('progressive.jpg');
const comment = read('comment.jpg');

// --- real photos pass
let r = cleanJpeg(baseline);
check('a normal JPEG passes', r.ok && r.width === 64 && r.height === 48, r.ok ? `${r.width}x${r.height}` : r.reason);
check('...and still opens', r.ok && decodeOk(r.bytes));

r = cleanJpeg(read('browser.jpg'));
check('a JPEG from a real browser encoder passes', r.ok && r.width === 120 && r.height === 90, r.ok ? `${r.width}x${r.height}` : r.reason);
check('...and still opens', r.ok && decodeOk(r.bytes));

r = cleanJpeg(progressive);
check('a progressive JPEG passes', r.ok && r.width === 64 && r.height === 48, r.ok ? '' : r.reason);
check('...and still opens', r.ok && decodeOk(r.bytes));

// --- metadata is removed
r = cleanJpeg(comment);
check('a comment segment is removed', r.ok && text(comment).includes('secret comment') && !text(r.bytes).includes('secret comment'));
check('...and the photo still opens', r.ok && decodeOk(r.bytes));

const exif = segment(0xe1, 'Exif\0\0MM\0*GPSLatitude 44.97 N GPSLongitude 93.26 W SerialNumber 1234');
const withExif = cat(baseline.subarray(0, 2), exif, baseline.subarray(2));
r = cleanJpeg(withExif);
check('EXIF (GPS location, camera serial) is removed', r.ok && !text(r.bytes).includes('GPSLatitude') && !text(r.bytes).includes('SerialNumber'));
check('...and the photo still opens', r.ok && decodeOk(r.bytes));

const xmp = segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>location</x:xmpmeta>');
r = cleanJpeg(cat(baseline.subarray(0, 2), xmp, baseline.subarray(2)));
check('XMP is removed', r.ok && !text(r.bytes).includes('xmpmeta'));

const icc = segment(0xe2, 'ICC_PROFILE\0\x01\x01fake-profile-bytes');
r = cleanJpeg(cat(baseline.subarray(0, 2), icc, baseline.subarray(2)));
check('the colour profile (ICC) is kept', r.ok && text(r.bytes).includes('ICC_PROFILE'));

// --- nothing can ride along after the picture
const zip = 'PK\x03\x04 a zip file pretending to be part of the photo \xff\xd9';
r = cleanJpeg(cat(baseline, zip));
check('anything appended after the image is cut off (even with a fake end marker)',
  r.ok && !text(r.bytes).includes('PK\x03\x04') && r.bytes.length === baseline.length,
  r.ok ? `${r.bytes.length} bytes vs ${baseline.length}` : r.reason);

// --- not photos
const refuse = (name: string, bytes: Uint8Array, reason: string) => {
  const res = cleanJpeg(bytes);
  check(name, !res.ok && res.reason === reason, res.ok ? 'accepted' : res.reason);
};
refuse('a PNG is refused', read('red.png'), 'not_a_jpeg');
refuse('an HTML page is refused', read('page.html'), 'not_a_jpeg');
refuse('an HTML page behind a JPEG header is refused',
  cat([0xff, 0xd8, 0xff, 0xe0], '<html><script>alert(1)</script></html>'), 'not_a_jpeg');
refuse('an SVG is refused', cat('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'not_a_jpeg');
refuse('a cut-off JPEG is refused', baseline.subarray(0, baseline.length - 40), 'not_a_jpeg');
refuse('a JPEG header with no picture is refused', cat([0xff, 0xd8, 0xff, 0xd9]), 'not_a_jpeg');
refuse('an empty file is refused', new Uint8Array(0), 'not_a_jpeg');
refuse('a file over 10 MB is refused', new Uint8Array(MAX_PHOTO_BYTES + 1), 'too_large');
refuse('an unknown segment type before the picture is refused',
  cat(baseline.subarray(0, 2), segment(0xf0, 'weird'), baseline.subarray(2)), 'not_a_jpeg');

// Find the size (SOF) segment and change the picture's size in it.
const withSize = (w: number, h: number) => {
  const b = new Uint8Array(baseline);
  for (let i = 2; i < b.length - 9; i++) {
    if (b[i] === 0xff && (b[i + 1] === 0xc0 || b[i + 1] === 0xc2)) {
      b[i + 5] = h >> 8; b[i + 6] = h & 0xff; b[i + 7] = w >> 8; b[i + 8] = w & 0xff;
      return b;
    }
  }
  throw new Error('no SOF in fixture');
};
refuse('a zero-pixel image is refused', withSize(0, 48), 'bad_size');
refuse('an absurdly large image (decompression bomb) is refused', withSize(60000, 60000), 'bad_size');

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
