// Builds dist/harness.html: the real content-script bundle running on a page
// that impersonates excalidraw.com's storage layout.
//
// A content script only runs inside a loaded extension, and chrome://extensions
// cannot be driven by automation, so this is the only way to exercise the panel
// without a human in the loop. It seeds the exact localStorage keys the bridge
// reads, so bridge logic, document storage and history all come under test.
//
// It does NOT prove the script injects into the real excalidraw.com, nor that
// the shadow root coexists with their UI. That still needs a real unpacked load.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

async function findAsset(prefix) {
  const files = await readdir(path.join(root, 'dist/assets'));
  // The loader shim crxjs emits shares the prefix; we want the real module.
  const hit = files.find((f) => f.startsWith(prefix) && !f.includes('loader') && f.endsWith('.js'));
  if (!hit) throw new Error(`No built asset starting with "${prefix}" in dist/assets.`);
  return `/assets/${hit}`;
}

async function optionsEntry() {
  const built = await readFile(path.join(root, 'dist/src/options/index.html'), 'utf8');
  return {
    script: built.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1],
    style: built.match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)?.[1],
  };
}

// Shaped exactly like excalidraw.com writes it: a bare element array.
const el = (id, x, y, w, h, colour) => ({
  id, type: 'rectangle', x, y, width: w, height: h, angle: 0,
  strokeColor: colour, backgroundColor: 'transparent', fillStyle: 'solid',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
  groupIds: [], frameId: null, roundness: { type: 3 }, seed: 1,
  version: 12, versionNonce: 1, isDeleted: false, boundElements: null,
  updated: 1, link: null, locked: false,
});

const SEED_ELEMENTS = [
  el('seed-a', 100, 100, 180, 100, '#1971c2'),
  el('seed-b', 320, 100, 180, 100, '#2f9e44'),
  el('seed-c', 210, 250, 180, 100, '#e03131'),
];

const shim = `
  // ---- excalidraw.com's storage, impersonated -------------------------------
  if (!localStorage.getItem('excalidraw')) {
    localStorage.setItem('excalidraw', ${JSON.stringify(JSON.stringify(SEED_ELEMENTS))});
    localStorage.setItem('excalidraw-state', JSON.stringify({
      viewBackgroundColor: '#ffffff', theme: 'light', gridSize: 20,
      scrollX: 0, scrollY: 0, zoom: { value: 1 },
    }));
  }

  // ---- chrome.* -------------------------------------------------------------
  const LS = '__harness_chrome_storage_local';
  const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
  const store = load();
  const listeners = [];
  const msgListeners = [];

  window.chrome = {
    runtime: {
      id: 'harness-not-a-real-extension',
      getURL: (p) => new URL('/' + String(p).replace(/^\\/+/, ''), location.origin).toString(),
      getManifest: () => ({ manifest_version: 3, name: 'Excalidraw Cloud (harness)', version: '0.0.0' }),
      openOptionsPage: () => window.open('/harness-options.html', '_blank'),
      onMessage: {
        addListener: (fn) => msgListeners.push(fn),
        removeListener: (fn) => { const i = msgListeners.indexOf(fn); if (i >= 0) msgListeners.splice(i, 1); },
      },
    },
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...store };
          const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          const out = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        },
        async set(items) {
          const changes = {};
          for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
          localStorage.setItem(LS, JSON.stringify(store));
          listeners.forEach((fn) => fn(changes, 'local'));
        },
        async remove(keys) {
          for (const k of (typeof keys === 'string' ? [keys] : keys)) delete store[k];
          localStorage.setItem(LS, JSON.stringify(store));
        },
      },
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
      },
    },
  };

  // ---- fake service worker --------------------------------------------------
  // Scene bodies now live in the worker's IndexedDB, reached over messages, so
  // the harness has to answer those messages or nothing loads at all.
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open('excalidraw-cloud-harness', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('scenes')) db.createObjectStore('scenes');
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('byDoc', 'docId');
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => {
    const db = await idb();
    return new Promise((res, rej) => {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  };

  const dbOps = {
    readScene: (id) => tx('scenes', 'readonly', (s) => s.get(id)),
    writeScene: (id, scene) => tx('scenes', 'readwrite', (s) => s.put(scene, id)).then(() => undefined),
    deleteScene: (id) => tx('scenes', 'readwrite', (s) => s.delete(id)).then(() => undefined),
    putSnapshot: (entry) => tx('snapshots', 'readwrite', (s) => s.put(entry)).then(() => undefined),
    readSnapshot: (id) => tx('snapshots', 'readonly', (s) => s.get(id)),
    deleteSnapshot: (id) => tx('snapshots', 'readwrite', (s) => s.delete(id)).then(() => undefined),
    async deleteSnapshotsForDoc(docId) {
      const all = await tx('snapshots', 'readonly', (s) => s.getAll());
      for (const e of all.filter((e) => e.docId === docId)) await dbOps.deleteSnapshot(e.id);
    },
    estimateUsage: async () => (await navigator.storage?.estimate?.())?.usage ?? null,
  };

  // Drive is genuinely unavailable in the harness: chrome.identity does not
  // exist outside a real extension. The panel should degrade, not crash.
  // ?drive=configured / ?drive=connected exercise the panel's other two states
  // without needing a real Cloud project.
  const driveMode = new URLSearchParams(location.search).get('drive') || 'off';
  const syncOps = {
    status: async () => ({
      configured: driveMode !== 'off',
      connected: driveMode === 'connected',
      label: 'Google Drive',
    }),
    connect: async () => { throw new Error('Google Drive needs a real extension build.'); },
    disconnect: async () => undefined,
    push: async () => ({ synced: false, error: 'Not connected to Google Drive.' }),
    pushAll: async () => ({ pushed: 0, failed: 0 }),
    renameRemote: async () => undefined,
    removeRemote: async () => undefined,
    listRemoteOnly: async () => [],
    pull: async () => { throw new Error('Not connected.'); },
  };

  window.chrome.runtime.sendMessage = async (msg) => {
    const table = msg && msg.kind === 'db' ? dbOps : msg && msg.kind === 'sync' ? syncOps : null;
    if (!table) return undefined;
    const fn = table[msg.op];
    if (!fn) return { ok: false, error: 'Unknown operation ' + msg.op };
    try { return { ok: true, value: await fn(...(msg.args || [])) }; }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  };

  // Stands in for the toolbar button.
  window.__togglePanel = () => msgListeners.forEach((fn) => fn({ type: 'toggle-panel' }, {}, () => {}));

  window.addEventListener('error', (e) => console.error('[HARNESS] error:', e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[HARNESS] rejection:', e.reason?.message ?? e.reason));
`;

const contentScript = await findAsset('main.tsx-');

await writeFile(
  path.join(root, 'dist/harness.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Excalidraw Cloud — content harness</title>
    <script>${shim}</script>
    <style>
      body { margin: 0; font: 14px system-ui; background: #fafafa; color: #333; }
      .fake { padding: 40px; max-width: 640px; }
      code { background: #eee; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <div class="fake">
      <h2>Stand-in for excalidraw.com</h2>
      <p>Seeds the same <code>localStorage</code> keys excalidraw.com uses, so the
         bridge reads a realistically shaped scene.</p>
      <p>Toggle the panel with <code>window.__togglePanel()</code> or the tab on the right.</p>
    </div>
    <script type="module" src="${contentScript}"></script>
  </body>
</html>
`,
);
console.log(`[make-harness] dist/harness.html -> ${contentScript}`);

const opts = await optionsEntry();
if (opts.script) {
  await writeFile(
    path.join(root, 'dist/harness-options.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Excalidraw Cloud — settings harness</title>
    <script>${shim}</script>
${opts.style ? `    <link rel="stylesheet" crossorigin href="${opts.style}">` : ''}
    <script type="module" crossorigin src="${opts.script}"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`,
  );
  console.log(`[make-harness] dist/harness-options.html -> ${opts.script}`);
}
