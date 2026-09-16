// Generates public/gator-skin.png: a tileable Voronoi cell-fracture texture
// used as the About-page jumbotron background (see .jumbotron::before in
// public/styles.css). Re-run with `npm run generate-gator-skin` after
// tweaking SIZE/NUM_SEEDS/colors below.
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const SIZE = 420;
const NUM_SEEDS = 95;
const OUT = path.join(__dirname, '..', 'public', 'gator-skin.png');

// Deterministic PRNG so re-runs are reproducible.
let seedState = 42;
function rand() {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
}

function mix(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t));
}

// Seed points with light relaxation (push apart neighbors a bit) so cells
// read as roughly scale-sized rather than wildly uneven.
const seeds = [];
for (let i = 0; i < NUM_SEEDS; i++) {
  seeds.push({ x: rand() * SIZE, y: rand() * SIZE, tone: rand() });
}
for (let iter = 0; iter < 2; iter++) {
  for (const s of seeds) {
    let fx = 0, fy = 0;
    for (const o of seeds) {
      if (o === s) continue;
      let dx = s.x - o.x, dy = s.y - o.y;
      if (dx > SIZE / 2) dx -= SIZE; if (dx < -SIZE / 2) dx += SIZE;
      if (dy > SIZE / 2) dy -= SIZE; if (dy < -SIZE / 2) dy += SIZE;
      const d2 = dx * dx + dy * dy;
      if (d2 < 900 && d2 > 0.01) { const d = Math.sqrt(d2); fx += (dx / d) * (30 - d) * 0.15; fy += (dy / d) * (30 - d) * 0.15; }
    }
    s.x = ((s.x + fx) % SIZE + SIZE) % SIZE;
    s.y = ((s.y + fy) % SIZE + SIZE) % SIZE;
  }
}

// Navy fill tone variants per cell (subtle mosaic variation, like the reference).
// Darker and much lower-alpha than the first pass — this needs to read as
// barely-there texture behind text, not a bold graphic competing with it.
const fillTones = [
  [16, 27, 63], [13, 22, 52], [19, 31, 71], [10, 17, 42], [17, 28, 67],
];
const ORANGE = [239, 106, 44];
const rim = mix([55, 75, 140], ORANGE, 0.12); // muted blue rim, warmed just slightly
const gap = mix([4, 7, 18], ORANGE, 0.22); // dark "mortar" — a hint of the original orange, not the orange itself

// Pass 1: the raw Voronoi boundary field (how far this pixel is from being
// equidistant between its two nearest scales — 0 = exactly on the edge).
const diff = new Float32Array(SIZE * SIZE);
const nearestTone = new Float32Array(SIZE * SIZE);
const WRAPS = [-SIZE, 0, SIZE];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let d1 = Infinity, d2 = Infinity, nearest = null;
    for (const s of seeds) {
      for (const wx of WRAPS) {
        for (const wy of WRAPS) {
          const dx = x - (s.x + wx);
          const dy = y - (s.y + wy);
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; nearest = s; }
          else if (d < d2) { d2 = d; }
        }
      }
    }
    const i = y * SIZE + x;
    diff[i] = Math.sqrt(d2) - Math.sqrt(d1);
    nearestTone[i] = nearest.tone;
  }
}

// Pass 2: blur the boundary field (toroidal, so it keeps tiling seamlessly).
// This is what turns the sharp polygon corners into rounded ones — the
// color bands in pass 3 follow the smoothed field, not the raw straight
// Voronoi edges.
function blur(field, radius, passes) {
  let src = field;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let sum = 0, count = 0;
        for (let ky = -radius; ky <= radius; ky++) {
          const yy = (y + ky + SIZE) % SIZE;
          for (let kx = -radius; kx <= radius; kx++) {
            const xx = (x + kx + SIZE) % SIZE;
            sum += src[yy * SIZE + xx];
            count++;
          }
        }
        tmp[y * SIZE + x] = sum / count;
      }
    }
    src = tmp;
  }
  return src;
}
const smoothDiff = blur(diff, 2, 3);

// Pass 3: quantize the smoothed field into gap / rim / fill color bands.
const png = new PNG({ width: SIZE, height: SIZE });
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x;
    const d = smoothDiff[i];

    let r, g, b, a;
    if (d < 1.6) {
      [r, g, b] = gap; a = 120;
    } else if (d < 4.4) {
      [r, g, b] = rim; a = 55;
    } else {
      const t = fillTones[Math.floor(nearestTone[i] * fillTones.length) % fillTones.length];
      [r, g, b] = t; a = 65;
    }

    const idx = i << 2;
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = a;
  }
}

png.pack().pipe(fs.createWriteStream(OUT)).on('finish', () => {
  console.log('wrote', OUT);
});
