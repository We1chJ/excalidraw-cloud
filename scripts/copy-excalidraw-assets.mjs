// Copies Excalidraw's font files into public/ so the editor renders with no network access.
//
// EXCALIDRAW_ASSET_PATH must point at the directory CONTAINING a `fonts/` folder,
// so the fonts land at public/excalidraw-assets/fonts/* and the runtime path is
// chrome.runtime.getURL('excalidraw-assets/').
//
// Runs on postinstall so a fresh clone works without a manual step.
import { cp, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const src = path.join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const dest = path.join(root, 'public/excalidraw-assets/fonts');

try {
  await access(src);
} catch {
  console.warn(`[copy-excalidraw-assets] skipped: ${src} not found (deps not installed yet?)`);
  process.exit(0);
}

await mkdir(path.dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`[copy-excalidraw-assets] copied fonts -> public/excalidraw-assets/fonts`);
