// MV3 forbids remotely hosted CODE. It does not forbid a URL appearing in a
// string -- bundled libraries are full of license headers and error-message doc
// links, and flagging those is noise that trains you to ignore the check.
//
// What actually violates the policy is a remote URL reaching a code-loading
// sink, or eval/new Function at runtime. That is what this looks for.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const dist = path.join(root, 'dist');

// Sinks that can turn a URL into running code.
const SINKS = [
  { name: 'dynamic import()', re: /\bimport\s*\(\s*["'`](https?:[^"'`]+)/g },
  { name: 'importScripts()', re: /\bimportScripts\s*\(\s*["'`](https?:[^"'`]+)/g },
  { name: 'new Worker()', re: /\bnew\s+Worker\s*\(\s*["'`](https?:[^"'`]+)/g },
  { name: 'script.src', re: /\.src\s*=\s*["'`](https?:[^"'`]+)/g },
  { name: 'script tag', re: /<script[^>]+src\s*=\s*["'](https?:[^"']+)/g },
];

const EVAL = [
  { name: 'eval()', re: /(?<![.\w$])eval\s*\(/g },
  { name: 'new Function()', re: /\bnew\s+Function\s*\(/g },
];

/**
 * Findings that are real but understood and neutralised.
 *
 * Listed explicitly so anything NOT here fails loudly. A check that always
 * exits non-zero is a check people stop reading.
 */
const KNOWN = [
  {
    match: (v) =>
      v.includes('platform.twitter.com/widgets.js') ||
      v.includes('embed.reddit.com/widgets.js'),
    why:
      'Excalidraw embeddable elements. Neutralised by validateEmbeddable={false} ' +
      'in ExcalidrawPane.tsx -- no embed can be created, so the tag is never injected.',
  },
  {
    match: (v) => v.startsWith('new Function()') && v.includes('subset-shared'),
    why:
      'Emscripten glue for the harfbuzz font-subsetting WASM. Not on the drawing ' +
      'or saving path; reached only during font-embedding export. MV3 CSP has no ' +
      'unsafe-eval escape hatch, so this cannot be configured away.',
  },
];

// Hosts we expect to see as inert strings, so the summary can stay quiet.
const EXPECTED_INERT = [
  'w3.org',
  'github.com',
  'excalidraw.com',
  'chevrotain.io',
  'langium.org',
  'lodash.com',
  'openjsf.org',
  'jquery.org',
  'tldrlegal.com',
  'opensource.org',
  'en.wikipedia.org',
  'underscorejs.org',
  'engelschall.com',
  'mermaid.js.org',
  'react.dev',
  'discord.gg',
  // Link targets and embed hosts rendered in Excalidraw's UI. Inert because
  // validateEmbeddable={false} stops any embed from being created.
  'youtube.com',
  'player.vimeo.com',
  'figma.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'giphy.com',
  // Excalidraw's own collaboration backend. Unreachable here: this extension
  // never enables collaboration, which is explicitly out of scope.
  'cloudfunctions.net',
  'firebaseio.com',
  // Excalidraw appends this CDN as the LAST font candidate, after the local
  // EXCALIDRAW_ASSET_PATH entry. Reached only if the bundled fonts fail to
  // resolve, and fonts are assets, not code. The offline test in the README is
  // what actually proves it never fires.
  'esm.sh',
  // Declared in host_permissions for Drive sync.
  'googleapis.com',
  'accounts.google.com',
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const violations = [];
const inertHosts = new Map();
let scanned = 0;

for await (const file of walk(dist)) {
  if (!/\.(js|mjs|css|html)$/.test(file)) continue;
  scanned++;
  const text = await readFile(file, 'utf8');
  const rel = path.relative(root, file).replace(/\\/g, '/');

  for (const { name, re } of SINKS) {
    for (const m of text.matchAll(re)) {
      violations.push(`${name} -> ${m[1]}  [${rel}]`);
    }
  }

  for (const { name, re } of EVAL) {
    const count = [...text.matchAll(re)].length;
    if (count) violations.push(`${name} x${count}  [${rel}]`);
  }

  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    const host = m[1].toLowerCase();
    inertHosts.set(host, (inertHosts.get(host) ?? 0) + 1);
  }
}

const unexpected = [...inertHosts.entries()]
  .filter(([host]) =>
    !EXPECTED_INERT.some((known) => host === known || host.endsWith(`.${known}`)),
  )
  .sort((a, b) => b[1] - a[1]);

console.log(`Scanned ${scanned} files in dist/.\n`);

if (unexpected.length) {
  console.log('Unreviewed hosts referenced as inert strings (not loaded as code):');
  for (const [host, count] of unexpected) console.log(`  ${host} (${count}x)`);
  console.log('  -- review once; add to EXPECTED_INERT if they are just links.\n');
}

const known = violations.filter((v) => KNOWN.some((k) => k.match(v)));
const fresh = violations.filter((v) => !KNOWN.some((k) => k.match(v)));

if (known.length) {
  console.log('Known and mitigated:');
  for (const v of known) {
    console.log(`  ${v}`);
    console.log(`    ${KNOWN.find((k) => k.match(v))?.why}`);
  }
  console.log();
}

if (fresh.length) {
  console.error('NEW MV3 REMOTE CODE VIOLATIONS:\n');
  for (const v of fresh) console.error(`  ${v}`);
  console.error(`\n${fresh.length} unreviewed violation(s). These will fail Web Store review.`);
  process.exit(1);
}

console.log('No unreviewed remote-code sinks, eval, or new Function in dist/.');
