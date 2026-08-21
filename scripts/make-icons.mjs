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

const VIOLET = [124, 118, 240]; // gradient top
const INDIGO = [88, 82, 199];   // gradient bottom
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
 * The artwork's own bounding box is taller above the base than below it, so
 * without this nudge the mark sits visibly high in the tile.
 */
const OY = 0.062;

/**
 * The cloud: four lobes over a flat base. Lobe centres are spread wider and the
 * radii differ more than a naive cloud, because at 16px similar lobes merge into
 * an amorphous lump.
 */
function sdCloud(px, py) {
  return Math.min(
    sdCircle(px, py, 0.430, 0.400 + OY, 0.170),
    sdCircle(px, py, 0.660, 0.470 + OY, 0.128),
    sdCircle(px, py, 0.258, 0.478 + OY, 0.108),
    sdRoundedBox(px, py, 0.455, 0.545 + OY, 0.245, 0.070, 0.062),
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
  const at = (t) => [x0 + (x1 - x0) * t, 0.458 + OY + amp * Math.sin(t * Math.PI * periods)];
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

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  // Small sizes need more samples: at 16px a single pixel spans a lot of the
  // artwork, and the wobble aliases badly without them.
  const SS = size <= 32 ? 6 : 4;
  const total = SS * SS;

  // Stroke weight in unit space. Clamped so the outline never falls below ~1.7
  // device pixels -- a hairline outline disappears entirely at 16px.
  const outlineW = Math.max(0.052, 1.7 / size);
  const scribbleW = Math.max(0.040, 1.4 / size);

  // Below this size the mark is drawn as a solid silhouette instead of an
  // outline with a wave inside.
  //
  // At 16px a stroke thick enough to be visible is also thick enough to close
  // up the cloud's interior, and the wave merges into it -- the result reads as
  // a spiral, not a cloud. A filled cloud reads instantly at any size. Swapping
  // artwork for small sizes is standard icon practice.
  const SOLID_BELOW = 24;
  const solid = size <= SOLID_BELOW;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let ink = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;

          if (sdRoundedBox(px, py, 0.5, 0.5, 0.5, 0.5, 0.225) <= 0) bg++;

          // At display sizes the cloud is an OUTLINE, not a fill: everything in
          // Excalidraw is an outline, and it is what makes the mark read as
          // hand-drawn.
          // The solid variant is scaled up: without the outline around it the
          // silhouette alone leaves too much empty tile.
          const k = solid ? 1.14 : 1;
          const cx = (px - 0.5) / k + 0.5;
          const cy = (py - 0.5) / k + 0.5;
          const signed = sdCloud(cx, cy) + wobble(cx, cy, 0.008, 0.4);

          if (solid) {
            if (signed <= 0) ink++;
          } else {
            const cloud = Math.abs(signed) - outlineW / 2;
            const scribble = strokeDist(cx, cy, SCRIBBLE, 1.7) - scribbleW / 2;
            if (Math.min(cloud, scribble) <= 0) ink++;
          }
        }
      }

      const bgA = bg / total;
      const inkA = ink / total;

      // Vertical gradient across the tile.
      const t = y / Math.max(1, size - 1);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = VIOLET[c] + (INDIGO[c] - VIOLET[c]) * t;
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
