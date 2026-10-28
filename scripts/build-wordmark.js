/**
 * @file Builds public/logo-wordmark.png (the hero logo) from Images/logo.png.
 *
 *   npm run build-wordmark
 *
 * Two steps:
 *   1. Crop away the transparent margins around the artwork.
 *   2. Shrink it by an integer factor (averaging each block of pixels), so
 *      the file is sized for how big it's actually shown: at most ~260 CSS
 *      px tall, ~520 px on high-density phone screens. The full-size
 *      original was ~600 KB, the biggest download on the page.
 *
 * Averaging uses premultiplied alpha, so the logo's anti-aliased edges
 * don't pick up dark fringes from transparent pixels.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SOURCE = path.join(__dirname, '..', 'Images', 'logo.png');
const OUTPUT = path.join(__dirname, '..', 'public', 'logo-wordmark.png');
/** Smallest output height that still looks sharp at 2x pixel density. */
const MIN_OUTPUT_HEIGHT = 560;

/** Bounding box of every pixel that isn't fully transparent. */
function opaqueBounds(png) {
  let minX = png.width; let minY = png.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Crops `box` out of `src`, then averages each factor×factor block into one pixel. */
function cropAndShrink(src, box, factor) {
  const out = new PNG({ width: Math.floor(box.width / factor), height: Math.floor(box.height / factor) });
  const area = factor * factor;
  for (let oy = 0; oy < out.height; oy++) {
    for (let ox = 0; ox < out.width; ox++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((box.y + oy * factor + dy) * src.width + (box.x + ox * factor + dx)) * 4;
          const alpha = src.data[i + 3];
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
          a += alpha;
        }
      }
      const o = (oy * out.width + ox) * 4;
      out.data[o] = a ? Math.round(r / a) : 0;
      out.data[o + 1] = a ? Math.round(g / a) : 0;
      out.data[o + 2] = a ? Math.round(b / a) : 0;
      out.data[o + 3] = Math.round(a / area);
    }
  }
  return out;
}

const src = PNG.sync.read(fs.readFileSync(SOURCE));
const box = opaqueBounds(src);
const factor = Math.max(1, Math.floor(box.height / MIN_OUTPUT_HEIGHT));
const out = cropAndShrink(src, box, factor);
fs.writeFileSync(OUTPUT, PNG.sync.write(out, { deflateLevel: 9 }));
console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}: ${out.width}x${out.height}, ${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB`);
console.log(`Update the width/height attributes on img.wordmark in public/index.html to ${out.width} and ${out.height}.`);
