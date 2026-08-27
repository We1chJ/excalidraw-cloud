import type { AppState, BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { SceneData } from '../storage/types';

/**
 * Everything that depends on excalidraw.com's internal storage lives here.
 *
 * These keys are NOT a public API. Excalidraw can rename them in any deploy and
 * this file is what breaks. That is the cost of augmenting the real site instead
 * of shipping our own editor, and the reason it is quarantined in one module
 * with an explicit health check rather than spread through the UI.
 *
 * Verified against excalidraw.com on 2026-08-27:
 *   localStorage["excalidraw"]        bare array of elements
 *   localStorage["excalidraw-state"]  AppState object (~55 keys)
 *   indexedDB "files-db" / "files-store"   image blobs keyed by fileId
 */

export const KEYS = {
  elements: 'excalidraw',
  appState: 'excalidraw-state',
  filesDb: 'files-db',
  filesStore: 'files-store',
} as const;

export interface Health {
  ok: boolean;
  reason?: string;
}

/**
 * Confirms excalidraw.com still stores things where we expect.
 *
 * Called before the panel does anything. If this fails the panel disables
 * itself and says so, which is the difference between "the extension stopped
 * working" and "the extension quietly corrupted your drawings".
 */
export function checkHealth(): Health {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEYS.elements);
  } catch (err) {
    return { ok: false, reason: `localStorage is not readable: ${String(err)}` };
  }

  // A first-ever visit legitimately has no key yet. That is healthy -- an empty
  // canvas, not a broken schema.
  if (raw === null) return { ok: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `localStorage["${KEYS.elements}"] is not JSON.` };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      reason: `Expected localStorage["${KEYS.elements}"] to be an array of elements; got ${typeof parsed}. Excalidraw's storage format has probably changed.`,
    };
  }
  const first = parsed[0] as Record<string, unknown> | undefined;
  if (first && (typeof first.type !== 'string' || typeof first.version !== 'number')) {
    return {
      ok: false,
      reason: "Elements are missing `type`/`version`. Excalidraw's element schema has probably changed.",
    };
  }
  return { ok: true };
}

function readElements(): OrderedExcalidrawElement[] {
  const raw = localStorage.getItem(KEYS.elements);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OrderedExcalidrawElement[]) : [];
  } catch {
    return [];
  }
}

function readAppState(): Partial<AppState> {
  const raw = localStorage.getItem(KEYS.appState);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<AppState>) : {};
  } catch {
    return {};
  }
}

function openFilesDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(KEYS.filesDb);
    } catch {
      resolve(null);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // Never create the database ourselves -- if it does not exist, the page has
    // no images and there is nothing to read.
    req.onupgradeneeded = () => {
      req.transaction?.abort();
      resolve(null);
    };
  });
}

async function readFiles(elements: readonly OrderedExcalidrawElement[]): Promise<BinaryFiles> {
  const needed = new Set(
    elements
      .filter((el) => !el.isDeleted && 'fileId' in el && el.fileId)
      .map((el) => String((el as { fileId: string }).fileId)),
  );
  if (needed.size === 0) return {};

  const db = await openFilesDb();
  if (!db || !db.objectStoreNames.contains(KEYS.filesStore)) return {};

  try {
    return await new Promise<BinaryFiles>((resolve) => {
      const out: BinaryFiles = {};
      const store = db.transaction(KEYS.filesStore).objectStore(KEYS.filesStore);
      const req = store.getAll();
      req.onsuccess = () => {
        for (const value of req.result as BinaryFileData[]) {
          if (value && needed.has(String(value.id))) out[value.id] = value;
        }
        resolve(out);
      };
      req.onerror = () => resolve({});
    });
  } finally {
    db.close();
  }
}

/** Reads whatever is currently on the canvas. */
export async function readScene(): Promise<SceneData> {
  const elements = readElements().filter((el) => !el.isDeleted);
  const files = await readFiles(elements);
  return { elements, appState: readAppState(), files };
}

/**
 * Cheap change detector, standing in for Excalidraw's getSceneVersion().
 *
 * We deliberately do not import @excalidraw/excalidraw at runtime -- it would
 * pull the entire editor into a content script that runs on every page load.
 * Element `version` counters bump on every mutation, so summing them detects
 * edits without hashing element contents.
 */
export function sceneVersionOf(elements: readonly OrderedExcalidrawElement[]): number {
  let acc = 0;
  for (const el of elements) {
    acc = (acc + (typeof el.version === 'number' ? el.version : 0)) | 0;
  }
  return (acc + elements.length * 7919) | 0;
}

/** True when the canvas holds something worth warning about before replacing. */
export function hasContent(): boolean {
  return readElements().some((el) => !el.isDeleted);
}

/**
 * Replaces the canvas with a saved scene.
 *
 * A running excalidraw.com will not re-read localStorage, and it ignores
 * synthetic drop events (verified 2026-08-27 -- dispatching a DragEvent
 * carrying a .excalidraw File changed nothing). Writing storage and reloading
 * is the only mechanism that works, so callers must warn first.
 *
 * Returns without reloading; the caller decides when to call reload().
 */
export function writeScene(scene: SceneData): void {
  localStorage.setItem(KEYS.elements, JSON.stringify(scene.elements));

  // Merge rather than overwrite: appState carries editor preferences (theme,
  // current tool colours) that belong to the user, not to the saved drawing.
  const preserved = readAppState();
  const merged: Partial<AppState> = {
    ...preserved,
    ...scene.appState,
    // Scroll and zoom are per-view, and restoring a stale viewport strands the
    // user on empty canvas away from their own drawing.
    scrollX: preserved.scrollX,
    scrollY: preserved.scrollY,
    zoom: preserved.zoom,
  };
  localStorage.setItem(KEYS.appState, JSON.stringify(merged));
}

export function reload(): void {
  window.location.reload();
}
