// Builds dist/harness.html: the real editor bundle running in a plain page with
// the chrome.* APIs stubbed out.
//
// This exists because chrome://extensions cannot be driven by automation, so the
// only way to smoke-test the built editor without a human in the loop is to load
// the same JS over http. It verifies rendering, layout and font resolution.
// It does NOT verify anything extension-specific -- that still needs a real
// unpacked load.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
async function entryOf(page) {
  const built = await readFile(path.join(root, `dist/src/${page}/index.html`), 'utf8');
  const script = built.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1];
  const style = built.match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)?.[1];
  if (!script) throw new Error(`Could not find the ${page} entry script in the built HTML.`);
  return { script, style };
}

const shim = `
  // chrome.storage.local is persisted to localStorage so that reloading the
  // harness exercises the same restore path the real extension takes.
  const LS_KEY = '__harness_chrome_storage_local';
  const load = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } };
  const store = { local: load(), session: {} };
  const persist = (name) => { if (name === 'local') localStorage.setItem(LS_KEY, JSON.stringify(store.local)); };
  const listeners = [];
  const area = (name) => ({
    async get(keys) {
      if (keys == null) return { ...store[name] };
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in store[name]) out[k] = store[name][k];
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: store[name][k], newValue: v };
        store[name][k] = v;
      }
      persist(name);
      listeners.forEach((fn) => fn(changes, name));
    },
    async remove(keys) {
      for (const k of (typeof keys === 'string' ? [keys] : keys)) delete store[name][k];
      persist(name);
    },
  });

  window.chrome = {
    runtime: {
      id: 'harness-not-a-real-extension',
      getURL: (p) => new URL('/' + String(p).replace(/^\\/+/, ''), location.origin).toString(),
      getManifest: () => ({ manifest_version: 3, name: 'Excalidraw Cloud (harness)', version: '0.0.0' }),
      openOptionsPage: () => window.open('/harness-options.html', '_blank'),
    },
    storage: {
      local: area('local'),
      session: area('session'),
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
  };

  // Surface anything that breaks in a form read_console_messages can filter on.
  window.addEventListener('error', (e) => console.error('[HARNESS] error:', e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[HARNESS] rejection:', e.reason?.message ?? e.reason));
`;

function page(title, entry) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <script>${shim}</script>
${entry.style ? `    <link rel="stylesheet" crossorigin href="${entry.style}">` : ''}
    <script type="module" crossorigin src="${entry.script}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
}

for (const [name, title, out] of [
  ['editor', 'Excalidraw Cloud — harness', 'harness.html'],
  ['options', 'Excalidraw Cloud — settings harness', 'harness-options.html'],
]) {
  const entry = await entryOf(name);
  await writeFile(path.join(root, 'dist', out), page(title, entry));
  console.log(`[make-harness] dist/${out} -> ${entry.script}`);
}
