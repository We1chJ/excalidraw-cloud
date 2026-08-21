// Generates the toolbar/store icons as PNGs with no image dependencies.
// Run with `node scripts/make-icons.mjs` after changing the artwork below.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const outDir = path.join(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const ACCENT = [105, 101, 219];
const INK = [255, 255, 255];

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
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
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

/** Signed distance from a point to a line segment, for antialiased strokes. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size;
  const radius = s * 0.22;
  const SS = 3; // supersampling factor

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let bgCov = 0;
      let inkCov = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          // rounded square
          const qx = Math.max(radius - px, px - (s - radius), 0);
          const qy = Math.max(radius - py, py - (s - radius), 0);
          if (Math.hypot(qx, qy) <= radius) bgCov++;

          // a hand-drawn stroke: two segments forming a shallow "check"
          const d = Math.min(
            distToSegment(px, py, s * 0.26, s * 0.58, s * 0.44, s * 0.74),
            distToSegment(px, py, s * 0.44, s * 0.74, s * 0.76, s * 0.3),
          );
          if (d <= s * 0.075) inkCov++;
        }
      }

      const total = SS * SS;
      const bgA = bgCov / total;
      const inkA = (inkCov / total) * bgA;
      const i = (y * s + x) * 4;
      for (let c = 0; c < 3; c++) {
        buf[i + c] = Math.round(ACCENT[c] * (1 - inkA) + INK[c] * inkA);
      }
      buf[i + 3] = Math.round(bgA * 255);
    }
  }
  return buf;
}

for (const size of [16, 48, 128]) {
  writeFileSync(path.join(outDir, `icon-${size}.png`), png(size, render(size)));
  console.log(`[make-icons] public/icons/icon-${size}.png`);
}

// Larger copy for the README header. Lives outside public/ so it is not
// packaged into the extension.
const docsDir = path.join(root, 'docs/assets');
mkdirSync(docsDir, { recursive: true });
writeFileSync(path.join(docsDir, 'logo.png'), png(256, render(256)));
console.log('[make-icons] docs/assets/logo.png');
