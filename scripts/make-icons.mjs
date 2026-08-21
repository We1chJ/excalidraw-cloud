// Generates the toolbar/store icons and the README logo as PNGs, with no image
// dependencies. Run `npm run icons` after changing the artwork below.
//
// Art direction: Excalidraw's visual language -- the wobbly hand-drawn line and
// the #6965DB purple -- WITHOUT deriving from Excalidraw's actual logo, which is
// a trademark and not covered by their MIT code licence.
//
// The mark is a hand-drawn cloud with sketch strokes inside it: drawings, in the
// cloud. Everything is signed-distance-field based so the same source renders
// cleanly from 16px to 512px.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

// Excalidraw's brand purple is #6965DB. The tile is that colour, with a ~5%
// vertical shift centred on it -- lighter above, darker below -- so the eye
// reads a single confident colour with a little depth, not "a gradient".
//
// The previous version fell 15% across the tile, which is the look every
// generated logo has. Restraint is the whole difference: real product marks are
// flat or near-flat, and the gradient should not be nameable.
const TILE_TOP = [111, 107, 224];    // #6F6BE0
const TILE_BOTTOM = [99, 95, 214];   // #635FD6
const PAPER = [255, 255, 255];

// ---------------------------------------------------------------- png writer

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- shapes
// All in unit space (0..1), so the artwork is resolution independent.

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function sdSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/**
 * Cheap deterministic wobble. Perturbing a shape's distance field by a couple of
 * sine octaves is what sells the hand-drawn look -- it is the same trick roughjs
 * uses, just applied to an SDF instead of a path.
 */
function wobble(px, py, amp, seed = 0) {
  return (
    amp * (
      0.60 * Math.sin(px * 21.7 + py * 13.1 + seed) +
      0.28 * Math.sin(px * 41.3 - py * 33.9 + seed * 2.3) +
      0.12 * Math.sin(px * 71.1 + py * 59.7 + seed * 4.1)
    )
  );
}

/**
 * The cloud: four lobes over a flat base. Lobe centres are spread wider and the
 * radii differ more than a naive cloud, because at 16px similar lobes merge into
 * an amorphous lump.
 */
function sdCloud(px, py) {
  return Math.min(
    sdCircle(px, py, 0.430, 0.400, 0.170),
    sdCircle(px, py, 0.660, 0.470, 0.128),
    sdCircle(px, py, 0.258, 0.478, 0.108),
    sdRoundedBox(px, py, 0.455, 0.545, 0.245, 0.070, 0.062),
  );
}

/**
 * A single wavy stroke inside the cloud.
 *
 * Two earlier attempts failed for the same reason -- they resembled some other
 * icon. Stacked parallel lines read as a hamburger menu; a zigzag read as a
 * mountain range, which made the whole mark look like a photo placeholder. A
 * smooth wave reads as a drawn line and nothing else.
 */
function makeScribble(periods, amp, x0, x1) {
  const segs = [];
  const steps = 16;
  const at = (t) => [x0 + (x1 - x0) * t, 0.458 + amp * Math.sin(t * Math.PI * periods)];
  for (let i = 0; i < steps; i++) {
    segs.push([...at(i / steps), ...at((i + 1) / steps)]);
  }
  return segs;
}

// Full-detail wave for large renders.
const SCRIBBLE = makeScribble(3.1, 0.038, 0.322, 0.602);

// Nothing at 16px: see the note on SOLID_BELOW in render().

function strokeDist(px, py, segs, seed) {
  let d = Infinity;
  for (const g of segs) {
    d = Math.min(d, sdSegment(px, py, g[0], g[1], g[2], g[3]));
  }
  // One wobble for the whole polyline rather than per segment: per-segment noise
  // makes a continuous stroke look chopped into pieces.
  return d + wobble(px, py, 0.005, seed);
}

// ------------------------------------------------------------------ renderer

/** True where the mark's white ink covers this point. */
function inkAt(px, py, cfg) {
  const cx = (px - 0.5 - cfg.ox) / cfg.k + 0.5;
  const cy = (py - 0.5 - cfg.oy) / cfg.k + 0.5;

  const signed = sdCloud(cx, cy) + wobble(cx, cy, 0.008, 0.4);

  // At display sizes the cloud is an OUTLINE, not a fill: everything in
  // Excalidraw is an outline, and it is what makes the mark read as hand-drawn.
  if (cfg.solid) return signed <= 0;

  const cloud = Math.abs(signed) - cfg.outlineW / 2;
  const scribble = strokeDist(cx, cy, SCRIBBLE, 1.7) - cfg.scribbleW / 2;
  return Math.min(cloud, scribble) <= 0;
}

/**
 * Measures the ink's actual bounding box.
 *
 * The artwork is not symmetric -- the cloud's lobes sit higher than its base and
 * the right lobe is larger than the left -- so its geometric centre is nowhere
 * near the centre of its defining coordinates. Measuring beats hand-tuning an
 * offset constant, and it stays correct if the artwork is edited later.
 */
function measureInk(cfg) {
  const N = 360;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const px = (i + 0.5) / N;
      const py = (j + 0.5) / N;
      if (!inkAt(px, py, cfg)) continue;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  return { minX, minY, maxX, maxY };
}

const MARGINS = [];

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  // Small sizes need more samples: at 16px a single pixel spans a lot of the
  // artwork, and the wobble aliases badly without them.
  const SS = size <= 32 ? 6 : 4;
  const total = SS * SS;

  // Below this size the mark is drawn as a solid silhouette instead of an
  // outline with a wave inside.
  //
  // At 16px a stroke thick enough to be visible is also thick enough to close up
  // the cloud's interior, and the wave merges into it -- the result reads as a
  // spiral, not a cloud. A filled cloud reads instantly at any size. Swapping
  // artwork for small sizes is standard icon practice.
  const solid = size <= 24;

  const cfg = {
    solid,
    // Stroke weight in unit space, clamped so the outline never falls below
    // ~1.7 device pixels -- a hairline outline disappears entirely at 16px.
    outlineW: Math.max(0.052, 1.7 / size),
    scribbleW: Math.max(0.040, 1.4 / size),
    // The solid variant is scaled up: without an outline around it, the
    // silhouette alone leaves too much empty tile.
    k: solid ? 1.14 : 1,
    ox: 0,
    oy: 0,
  };

  // Centre the ink in the tile. Measured against the same cfg that renders it,
  // so the outline width and the small-size scale are both accounted for.
  const box = measureInk(cfg);
  cfg.ox = 0.5 - (box.minX + box.maxX) / 2;
  cfg.oy = 0.5 - (box.minY + box.maxY) / 2;

  // Re-measure and report the margins. Centring is easy to break by editing the
  // artwork, and easy not to notice; printing the numbers makes it checkable
  // without having to eyeball a 16px image.
  const after = measureInk(cfg);
  MARGINS.push({
    size,
    left: after.minX,
    right: 1 - after.maxX,
    top: after.minY,
    bottom: 1 - after.maxY,
  });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let ink = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;

          if (sdRoundedBox(px, py, 0.5, 0.5, 0.5, 0.5, 0.225) <= 0) bg++;
          if (inkAt(px, py, cfg)) ink++;
        }
      }

      const bgA = bg / total;
      const inkA = ink / total;

      // Vertical gradient across the tile.
      const t = y / Math.max(1, size - 1);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = TILE_TOP[c] + (TILE_BOTTOM[c] - TILE_TOP[c]) * t;
        buf[i + c] = Math.round(base * (1 - inkA) + PAPER[c] * inkA);
      }
      buf[i + 3] = Math.round(bgA * 255);
    }
  }
  return buf;
}

// --------------------------------------------------------------------- write

const iconDir = path.join(root, 'public/icons');
mkdirSync(iconDir, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(path.join(iconDir, `icon-${size}.png`), png(size, render(size)));
  console.log(`[make-icons] public/icons/icon-${size}.png`);
}

// Larger copy for the README header. Lives outside public/ so it is not
// packaged into the extension.
const docsDir = path.join(root, 'docs/assets');
mkdirSync(docsDir, { recursive: true });
writeFileSync(path.join(docsDir, 'logo.png'), png(512, render(512)));
console.log('[make-icons] docs/assets/logo.png');

console.log('');
console.log('[make-icons] ink margins (left/right and top/bottom should match):');
for (const m of MARGINS) {
  const f = (n) => n.toFixed(4);
  const dx = Math.abs(m.left - m.right);
  const dy = Math.abs(m.top - m.bottom);
  const ok = dx < 0.005 && dy < 0.005 ? 'centred' : 'OFF-CENTRE';
  console.log(
    `  ${String(m.size).padStart(3)}px  L ${f(m.left)}  R ${f(m.right)}  ` +
    `T ${f(m.top)}  B ${f(m.bottom)}   ${ok}`,
  );
}
