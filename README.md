<div align="center">

<img src="docs/assets/logo.png" alt="Excalidraw Cloud" width="112" height="112">

# Excalidraw Cloud

**Your Excalidraw drawings, in your own cloud, on every device.**

A Chrome extension that embeds the Excalidraw editor and keeps your drawings in
your own storage. No backend, no accounts to manage, no server that can go away
and take your work with it.

<br>

<img alt="Chrome Extension" src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white">
<img alt="Excalidraw" src="https://img.shields.io/badge/Excalidraw-0.18-6965DB?style=for-the-badge&logo=excalidraw&logoColor=white">
<img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
<img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white">

<br><br>

<img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square">
<img alt="Status" src="https://img.shields.io/badge/status-phases%200--2%20complete-orange?style=flat-square">
<img alt="Storage" src="https://img.shields.io/badge/storage-Google%20Drive-0F9D58?style=flat-square&logo=googledrive&logoColor=white">
<img alt="Offline" src="https://img.shields.io/badge/offline-first-blueviolet?style=flat-square">

</div>

<br>

> **Status: phases 0–2 complete.** The editor runs fully offline and persists
> locally. Google Drive sync is next — the storage seam it plugs into is already
> in place.

---

<div align="center">

### How it works

</div>

You install the extension and click **Connect Google Drive**. Your drawings land
in a folder in **your** Drive, under **your** quota, owned by **you** — openable
and backupable without this extension ever running. There is no server in the
middle, so nothing of yours ever touches a machine belonging to whoever built
this.

Files are saved as plain `.excalidraw` JSON. Drag one onto excalidraw.com and it
opens. That is the guarantee against lock-in, and it is a hard requirement rather
than a nice-to-have.

---

## What works today

- Toolbar icon opens the Excalidraw editor in a full tab
- Drawings persist across reloads and browser restarts (IndexedDB)
- Document sidebar: create, rename, switch, delete
- Fonts render with the network disconnected — nothing is fetched at runtime
- Embedded images survive the save/reload round trip

## What doesn't yet

- Cloud sync. `LocalOnlyAdapter` is wired up; `GoogleDriveAdapter` is phase 3.
- The sync indicator always reads "Saved on this device", which is accurate.

---

## Development setup

Requires Node 20.19+ or 22.12+ for Vite 7/8. This repo pins **Vite 6**, which
runs on Node 18/20/22, so Node 20.17 works as-is.

```bash
npm install          # also copies Excalidraw's fonts into public/
npm run build        # typechecks, then bundles to dist/
npm run check:remote # verifies no remote code slipped into the bundle
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select the `dist/` folder.

For live reload during development, `npm run dev` and load `dist/` the same way.

### The extension ID is pinned

An unpacked extension's ID is normally derived from its folder path, so moving
the folder changes the ID and breaks the OAuth client binding. `manifest.config.ts`
carries a public key that pins it to:

```
ceblkplfjlpkgmioaohkodeibecamilh
```

`key.pem` (the private half) is gitignored. Regenerate both if you're forking:

```bash
openssl genrsa -out key.pem 2048
openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
```

Paste the output into the `KEY` constant in `manifest.config.ts`.

---

## Architecture

<div align="center">

```
editor tab
  └─ <Excalidraw /> ── onChange (debounced 800ms)
                          │
                          ▼
                 IndexedDB (working copy)      ← always succeeds, offline-safe
                          │
                          ▼
                    StorageAdapter             ← the swappable seam
                          │
                          ▼
                   Google Drive (phase 3)
```

</div>

IndexedDB is the working copy and is never allowed to fail. Cloud storage is
durable backup reached through `StorageAdapter`. Everything above that interface
is the editor and document manager; everything below is replaceable — an S3,
Dropbox or WebDAV adapter drops in without touching core.

| Path | Role |
|---|---|
| `src/storage/types.ts` | `StorageAdapter`, `DocMeta`, `SceneData` |
| `src/storage/documents.ts` | Document operations the UI calls |
| `src/storage/db.ts` | IndexedDB (scene bodies, with embedded images) |
| `src/storage/meta.ts` | `chrome.storage.local` (document index) |
| `src/storage/adapters/` | `local.ts` today, `googleDrive.ts` next |
| `src/editor/` | Editor tab: sidebar + canvas + sync indicator |
| `src/background/service-worker.ts` | Opens/focuses the editor tab |

### Why the index and the scenes live in different stores

The document index sits in `chrome.storage.local` so the service worker and
options page can read it without opening a database, and so every surface gets
change events for free. Scene bodies sit in IndexedDB because they carry
embedded image bytes and get large.

---

## Things that are easy to get wrong

**Serialize with `'local'`, not `'database'`.** `serializeAsJSON` only emits the
`files` map for `'local'`:

```js
files: type === "local" ? filterUsedFiles(elements, files) : undefined
```

Using `'database'` silently drops every embedded image. `'local'` is also what
excalidraw.com's own export uses, which is what keeps saved files openable there.

**Always `restore()` on the way in.** It migrates older schemas, repairs element
bindings, and rebuilds fields the editor expects as live objects rather than
plain JSON. Skipping it produces subtle breakage — `collaborators` arriving as a
plain object instead of a `Map` is the classic one.

**`EXCALIDRAW_ASSET_PATH` points at the parent of `fonts/`.** Excalidraw resolves
`./fonts/Excalifont/...` against it, so fonts must land at
`public/excalidraw-assets/fonts/` and the path is
`chrome.runtime.getURL('excalidraw-assets/')`. It's set in `src/editor/assets.ts`,
imported before anything touches Excalidraw — MV3's CSP forbids the inline
`<script>` the upstream docs suggest.

**Compare scene versions before writing.** `onChange` fires on every pointer move
during a drag, and also for pans, zooms and selection changes that alter nothing
persistent. `saveScene` compares `getSceneVersion()` and returns early.

**The container needs a real height.** Excalidraw fills 100% of its containing
block, so a parent without an explicit height collapses the canvas to nothing.

---

## MV3 remote-code compliance

`npm run check:remote` scans `dist/` for URLs reaching code-loading sinks
(`import()`, `importScripts`, `new Worker`, `script.src`) and for
`eval`/`new Function`. It deliberately ignores URLs that are merely present as
strings — bundled libraries are full of license headers and error-doc links, and
flagging those trains you to ignore the check.

Two findings are known and handled:

**Embeddable elements** pull in `platform.twitter.com/widgets.js` and
`embed.reddit.com/widgets.js`. That is remotely hosted code, which MV3 forbids.
The editor passes `validateEmbeddable={false}`, so no embed can ever be created
and the path stays dead.

**`new Function` in `subset-shared.chunk`** is Emscripten glue for the harfbuzz
WASM used in font subsetting. MV3's CSP has no escape hatch for it —
`unsafe-eval` is not permitted in extension pages. It is not on the drawing or
saving path; it is reached during font-embedding export. Verify what actually
breaks there before relying on SVG export.

## Smoke-testing without loading the extension

`chrome://extensions` cannot be driven by automation, which makes the built
editor awkward to test in a loop. `npm run harness` writes `dist/harness.html` —
the real editor bundle running in a plain page with `chrome.*` stubbed
(`chrome.storage.local` is backed by `localStorage` so reloads exercise the real
restore path).

```bash
npm run build
npm run harness
cd dist && npx http-server -p 8137 -c-1
# open http://127.0.0.1:8137/harness.html
```

This verifies rendering, layout, font resolution and the whole local persistence
path. It does **not** verify anything extension-specific — the service worker,
the real `chrome.storage`, or the manifest. Those still need a real unpacked
load. Delete `dist/harness.html` before packaging for the Web Store.

### What this has been used to verify

- Excalidraw renders, and the canvas gets a real height
- Text renders in Excalifont from bundled fonts, with **no request to `esm.sh`**
- Draw → reload → drawing restored, with `sceneVersion` recorded in the index
- Drop an image → reload → the image element **and** its `files` entry survive,
  which is the case `'database'` serialization would have silently destroyed
- Create, switch, rename across two documents, each keeping its own scene
- No console errors through any of the above

## Offline verification

The one test that matters for phase 1, and it has to be done for real:

1. Build and load the extension.
2. Disconnect from the network entirely — not DevTools throttling, actually off.
3. Reload the extension and open the editor.
4. Type some text. It should render in Excalidraw's hand-drawn face (Excalifont),
   not a system fallback.
5. Open DevTools → Network. There should be no font requests to `esm.sh`.

Excalidraw appends `https://esm.sh/@excalidraw/excalidraw@<version>/dist/prod/`
as the *last* font candidate, after the local path. It never fires when the
bundled fonts resolve — this test is what proves they do.

---

## The mark

`npm run icons` regenerates every icon and the README logo from
`scripts/make-icons.mjs` — signed distance fields rasterised straight to PNG
with no image dependencies, so one source renders cleanly from 16px to 512px.

It borrows Excalidraw's *visual language* — the wobbly hand-drawn line quality —
but is deliberately **not** derived from Excalidraw's logo. Their MIT licence
covers code, not their trademark, and a modified version of their mark on a
separate Web Store listing would read as an official Excalidraw product.

It is black pen on white paper — `#1B1B1F`, Excalidraw's own default stroke
colour, on flat white. No tint and no gradient anywhere.

Every stroke is drawn **twice**, with different wobble seeds, so the two passes
diverge and cross the way a pen does when you sketch a shape without lifting it.
That double pass is the most recognisable thing about roughjs, and so about how
Excalidraw looks: one clean wobbly line reads as a decorative font, two
overlapping ones read as drawn. It only works if the pen is thin enough for a
gap to open between the passes — at the earlier `0.040` weight they overlapped
completely and looked like a single lumpy line.

Small sizes get different artwork. At 16px an outline thick enough to be visible
is also thick enough to close up the cloud's interior, and the mark reads as a
spiral; below 24px it renders as a solid silhouette instead.

The paper is white rather than transparent because a transparent black mark
disappears on a dark browser toolbar. The trade-off is that the README logo is a
white card on GitHub's dark theme; if that bothers you, generate an inverted
variant and select it with `<picture>` and `prefers-color-scheme`.

## Bundle size

`dist/` is roughly 22 MB, dominated by two things:

- `Xiaolai` (13 MB) — the CJK font. Dropping it shrinks the package by more than
  half but breaks offline rendering of Chinese, Japanese and Korean text.
- Mermaid diagram support, which Excalidraw bundles for its text-to-diagram feature.

Both are well under the Chrome Web Store's limit. Trim only if you have a reason.

---

## License

MIT. Excalidraw is MIT-licensed; its copyright notice is retained in `NOTICE`.

<div align="center">
<br>
<sub>Built on <a href="https://github.com/excalidraw/excalidraw">Excalidraw</a> — your drawings, your Drive, your call.</sub>
</div>
