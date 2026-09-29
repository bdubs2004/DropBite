/**
 * Turn the supplied artwork (orange rounded card on a white margin) into a
 * full-bleed, opaque 1024 app icon: trim the white margin, then fill the four
 * corner triangles (outside the card's rounded arc) with the SAME vertical
 * gradient, so the orange runs corner to corner and iOS's own rounding gives a
 * clean edge. The fork / sparkle / bite design is left untouched.
 *
 * Usage: NODE_PATH=./node_modules node scripts/make-icon.js <src> <out>
 */
const sharp = require('sharp');

const SRC = process.argv[2];
const OUT = process.argv[3];
const S = 1024;

// The artwork's "white" is a warm cream (~#FFF4DE) and the corner margin tints
// yellow/peach, so a flat brightness test misses it. The reliable tell is the
// blue channel: cream keeps blue high and close to red, while every orange in
// the gradient has blue far below red. So match "light and not very orange".
const nearWhite = (r, g, b) => r > 200 && b > 150 && r - b < 95;

(async () => {
  // 1. Find the orange card's bounding box (everything that isn't the white
  //    margin / drop shadow) and crop to it, so the card fills the frame.
  const src = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = src.info.width;
  const H = src.info.height;
  const sd = src.data;
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!nearWhite(sd[i], sd[i + 1], sd[i + 2])) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // Square the box off (the card is square) so nothing is stretched.
  let bw = maxX - minX + 1;
  let bh = maxY - minY + 1;
  let side = Math.max(bw, bh);
  let left = Math.round(minX - (side - bw) / 2);
  let top = Math.round(minY - (side - bh) / 2);
  // Trim a few px inward so the anti-aliased cream/orange rim at the card's edge
  // is cut off — otherwise a faint light border survives along the straight
  // edges and the radius probe reads the blended edge instead of the orange.
  const inset = Math.round(side * 0.006);
  left += inset;
  top += inset;
  side -= inset * 2;
  left = Math.max(0, Math.min(left, W - side));
  top = Math.max(0, Math.min(top, H - side));

  const card = sharp(SRC)
    .extract({ left, top, width: side, height: side })
    .resize(S, S, { fit: 'fill' });
  const { data } = await card.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const at = (x, y) => (y * S + x) * 4;
  // Strong orange: unmistakably the card body (blue far below red), used for
  // both radius detection and gradient sampling so soft cream/AA never counts.
  const strongOrange = (r, g, b) => r > 180 && b < 120;

  // Per-row gradient colour = the first strong-orange pixel from the left.
  const grad = new Array(S).fill(null);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = at(x, y);
      if (strongOrange(data[i], data[i + 1], data[i + 2])) {
        grad[y] = [data[i], data[i + 1], data[i + 2]];
        break;
      }
    }
  }
  for (let y = 0; y < S; y++) {
    if (grad[y]) continue;
    let up = y, dn = y;
    while (up >= 0 && !grad[up]) up--;
    while (dn < S && !grad[dn]) dn++;
    grad[y] = grad[up >= 0 ? up : dn] || [255, 122, 24];
  }

  // Corner radius: where the orange first appears down the left edge and across
  // the top edge (they should agree — it's a symmetric rounded square).
  // Probe the very edge column/row (the rim AA was trimmed above): on a rounded
  // rect the straight edge's orange begins exactly at the corner radius, so the
  // first orange down x=0 (and across y=0) is the radius itself.
  const PROBE = 0;
  const firstOrange = (fn) => {
    for (let k = 0; k < S; k++) {
      const [x, y] = fn(k);
      const i = at(x, y);
      if (strongOrange(data[i], data[i + 1], data[i + 2])) return k;
    }
    return 40;
  };
  const rLeft = firstOrange((k) => [PROBE, k]);
  const rTop = firstOrange((k) => [k, PROBE]);
  const r = Math.max(60, Math.min(400, Math.round((rLeft + rTop) / 2)));

  // Fill the three plain corner triangles (outside the arc) with the row's
  // gradient, biting ~6px past the arc so no cream/AA ring survives. The
  // top-right is left alone: that corner is the intentional "bite".
  const out = Buffer.from(data);
  const edge = r - 6;
  const fillCorner = (cx, cy, xs, xe, ys, ye) => {
    for (let y = ys; y < ye; y++) {
      for (let x = xs; x < xe; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > edge * edge) {
          const i = at(x, y);
          const g = grad[y];
          out[i] = g[0];
          out[i + 1] = g[1];
          out[i + 2] = g[2];
        }
      }
    }
  };
  fillCorner(r, r, 0, r, 0, r); // top-left
  fillCorner(r, S - 1 - r, 0, r, S - r, S); // bottom-left
  fillCorner(S - 1 - r, S - 1 - r, S - r, S, S - r, S); // bottom-right
  for (let p = 0; p < S * S; p++) out[p * 4 + 3] = 255; // opaque — iOS needs it

  await sharp(out, { raw: { width: S, height: S, channels: 4 } })
    .removeAlpha() // App Store rejects icons that carry an alpha channel
    .png()
    .toFile(OUT);
  console.log(`wrote ${OUT} (cropped ${side}px @ ${left},${top}, radius ${r})`);
})();
