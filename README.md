<div align="center">

<img src="docs/assets/logo.png" alt="Excalidraw Cloud" width="112" height="112">

# Excalidraw Cloud

**Saved drawings and version history, on the real excalidraw.com.**

A Chrome extension that adds a sidebar to excalidraw.com for keeping named
drawings and their timelines — eventually in your own Google Drive. It does
nothing on any other site, and it does not replace the editor.

<br>

<img alt="Chrome Extension" src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white">
<img alt="Excalidraw" src="https://img.shields.io/badge/excalidraw.com-content%20script-1B1B1F?style=for-the-badge&logo=excalidraw&logoColor=white">
<img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white">

<br><br>

<img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square">
<img alt="Bundle" src="https://img.shields.io/badge/bundle-268%20KB-informational?style=flat-square">
<img alt="Storage" src="https://img.shields.io/badge/storage-local%20(Drive%20next)-orange?style=flat-square">

</div>

<br>

> **Status:** the sidebar works against local storage. Google Drive sync is the
> next phase — the adapter seam it plugs into is already in place.

---

## What it does

excalidraw.com holds exactly one canvas. Overwrite it and the previous drawing
is gone. This extension adds the missing layer: **named drawings, each with a
timeline of versions**, in a panel injected into the page.

- **Save canvas** — store what is on screen as a named drawing
- **Save version** — add a point to that drawing's timeline
- **Preview** — hover a drawing or a version to peek at it, click to pin the card
- **Open / Restore** — put a drawing, or an earlier version of it, back on the canvas
- Everything else about excalidraw.com is untouched

---

## How it works, and what that costs

The extension does not bundle an editor. It reads and writes excalidraw.com's
own storage from a content script:

| What | Where |
|---|---|
| Elements | `localStorage["excalidraw"]` — a bare array |
| App state | `localStorage["excalidraw-state"]` |
| Images | IndexedDB `files-db` → `files-store` |

**These are not a public API.** Excalidraw can rename them in any deploy, and
this extension is what breaks. That is the price of augmenting the real site
rather than shipping a copy of the editor.

The mitigation is `checkHealth()` in `src/excalidraw/bridge.ts`, which runs
before the panel does anything. If the shape it expects is gone, the panel
disables saving and loading and says so, rather than silently corrupting
drawings. All the fragile knowledge is quarantined in that one file.

### Loading a drawing reloads the page

There is no way around this. A running excalidraw.com never re-reads
`localStorage`, and it **ignores synthetic drop events** — verified on
2026-08-27 by dispatching a `DragEvent` carrying a `.excalidraw` `File`, which
changed nothing. Writing storage and reloading is the only mechanism that works,
so the panel always warns before replacing a non-empty canvas.

---

## Development

```bash
npm install
npm run build          # typecheck, then bundle to dist/
npm run check:remote   # no remote code or eval in the bundle
npm run harness        # build the offline test harness (below)
```

Then `chrome://extensions` → **Developer mode** → **Load unpacked** → `dist/`.
Open excalidraw.com and click the toolbar icon to toggle the panel.

If the panel does not appear on a tab that was already open, reload the tab —
content scripts are only injected into pages loaded after the extension.

### The extension ID is pinned

`manifest.config.ts` carries a public key that pins the ID to
`ceblkplfjlpkgmioaohkodeibecamilh` on any machine, so the OAuth client binding
survives moving the folder. `key.pem` (the private half) is gitignored;
regenerate with `openssl genrsa -out key.pem 2048` and
`openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A`.

---

## Layout

| Path | Role |
|---|---|
| `src/excalidraw/bridge.ts` | **All** knowledge of excalidraw.com's internals, plus the health check |
| `src/content/main.tsx` | Injects the panel into a shadow root |
| `src/content/Panel.tsx` | The sidebar: drawings, timelines, confirmations |
| `src/storage/documents.ts` | Document and snapshot operations |
| `src/storage/db.ts` | IndexedDB: scene bodies and snapshot bodies |
| `src/storage/meta.ts` | `chrome.storage.local`: document and snapshot indexes |
| `src/storage/adapters/` | `local.ts` today, `googleDrive.ts` next |
| `src/background/service-worker.ts` | Routes the toolbar click to the right tab |

The panel renders inside a **shadow root**. excalidraw.com ships a large global
stylesheet and so do we; without that boundary the first symptom would be their
canvas UI subtly breaking, which is what makes an extension feel like malware.

Bodies live in IndexedDB, indexes in `chrome.storage.local` — so the service
worker and options page can read the list without opening a database, and every
surface gets change events for free.

---

## Things that are easy to get wrong

**`files` must be populated when serialising.** The library's `serializeAsJSON`
emits the `files` map only for the `'local'` variant; `'database'` sets it to
`undefined` and silently drops every embedded image. `toExcalidrawFile()` builds
the payload by hand and always includes it.

**Thumbnails are drawn by hand, not by `exportToSvg`.** `ScenePreview.tsx`
renders straight from element geometry into SVG. Excalidraw ships an exporter,
but importing it pulls the whole editor into a content script that runs on every
page load — the exact cost this architecture exists to avoid. The thumbnail is
an approximation and says so: no roughjs wobble, hachure fills render as flat
translucent colour. It is for recognising *which* drawing this is, not for
reproducing it.

**Excalidraw is a devDependency, types only.** Importing it at runtime would
pull the entire editor into a content script that runs on every excalidraw.com
page load. `sceneVersionOf()` replaces `getSceneVersion()` in a few lines.

**Restoring must not clobber user preferences.** `writeScene()` merges rather
than overwrites app state, and deliberately keeps the *current* scroll and zoom
— restoring a stale viewport strands the user on empty canvas away from their
own drawing.

**Snapshots are capped.** `MAX_SNAPSHOTS = 30` per drawing, oldest pruned with
their bodies. An unbounded timeline of whole scenes including images is how you
fill somebody's Drive quota without telling them.

---

## Testing without loading the extension

A content script only runs inside a loaded extension, and `chrome://extensions`
cannot be automated. `npm run harness` writes `dist/harness.html`: the real
content bundle on a page that seeds the exact `localStorage` keys excalidraw.com
uses, with `chrome.*` stubbed.

```bash
npm run build && npm run harness
cd dist && npx http-server -p 8141 -c-1
# open http://127.0.0.1:8141/harness.html
```

Verified through it: panel injects into a shadow root, health check passes on a
well-formed scene, save creates a document and first snapshot, editing then
saving adds a second version, saving an unchanged canvas is refused rather than
duplicated, restoring an older version swaps the canvas while preserving
viewport and theme, corrupting the storage format disables exactly the
destructive actions, and previews render rectangles, ellipses, diamonds, arrows,
freedraw and text with an auto-fitted viewBox — with two versions of the same
drawing rendering visibly differently.

It does **not** prove injection into the real excalidraw.com, or that the shadow
root coexists with their UI. That needs a real unpacked load.

---

## The mark

`npm run icons` regenerates every icon and this logo from
`scripts/make-icons.mjs` — signed distance fields rasterised straight to PNG
with no image dependencies, one source from 16px to 512px.

Black pen on white paper, `#1B1B1F`. Every stroke is drawn twice with different
wobble seeds so the passes diverge and cross, which is what roughjs does and so
what makes it read as drawn rather than as a decorative font. Below 24px it
switches to a solid silhouette: an outline thick enough to see at that size also
closes up the cloud's interior.

It borrows Excalidraw's visual language but is deliberately **not** derived from
their logo — their MIT licence covers code, not their trademark.

---

## License

MIT. See `NOTICE` for Excalidraw's copyright, retained for the type definitions.

<div align="center">
<br>
<sub>Built for <a href="https://excalidraw.com">Excalidraw</a> — your drawings, your Drive, your call.</sub>
</div>
