import { serializeAsJSON, restore, getSceneVersion } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { readScene, writeScene, deleteScene } from './db';
import * as meta from './meta';
import type { DocMeta, SceneData } from './types';

/**
 * Document-level operations. The UI talks to this; it never touches IndexedDB
 * or chrome.storage directly.
 */

export const UNTITLED = 'Untitled drawing';

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Produces the canonical .excalidraw payload.
 *
 * `'local'` is deliberate and not interchangeable with `'database'`:
 * serializeAsJSON only emits the `files` map for `'local'`, so the `'database'`
 * variant drops every embedded image on the floor.
 */
export function serialize(scene: SceneData): string {
  return serializeAsJSON(
    scene.elements,
    scene.appState,
    scene.files,
    'local',
  );
}

/**
 * restore() is mandatory on the way in -- it migrates older schemas, repairs
 * element bindings, and rebuilds fields the editor expects as live objects
 * rather than plain JSON (collaborators being the classic one).
 */
export function deserialize(json: string): SceneData {
  const restored = restore(JSON.parse(json), null, null);
  return {
    elements: restored.elements,
    appState: restored.appState,
    files: restored.files,
  };
}

export const listDocs = meta.listDocs;
export const getDoc = meta.getDoc;
export const onIndexChanged = meta.onIndexChanged;
export const getActiveDocId = meta.getActiveDocId;
export const setActiveDocId = meta.setActiveDocId;

export async function createDoc(title = UNTITLED): Promise<DocMeta> {
  const now = Date.now();
  const doc: DocMeta = {
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    sceneVersion: 0,
    syncState: 'local',
  };
  await writeScene(doc.id, { elements: [], appState: {}, files: {} });
  await meta.putDoc(doc);
  return doc;
}

export async function loadScene(id: string): Promise<SceneData> {
  const stored = await readScene(id);
  if (!stored) return { elements: [], appState: {}, files: {} };
  // Round-trip through restore so a scene written by an older version of the
  // editor still opens cleanly.
  return deserialize(serialize(stored));
}

export interface SaveResult {
  saved: boolean;
  meta?: DocMeta;
}

/**
 * Writes the scene if it actually changed.
 *
 * onChange fires on every pointer move during a drag, and also for pans, zooms
 * and selection changes that alter nothing persistent. Comparing scene versions
 * keeps those from bumping updatedAt and queuing pointless syncs.
 */
export async function saveScene(
  id: string,
  elements: readonly OrderedExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<SaveResult> {
  const existing = await meta.getDoc(id);
  if (!existing) return { saved: false };

  const sceneVersion = getSceneVersion(elements);
  if (sceneVersion === existing.sceneVersion) return { saved: false };

  // Normalize through the serializer so IndexedDB never holds ephemeral UI
  // state (selection, cursor, the element currently being edited).
  const scene = deserialize(serialize({ elements, appState, files }));
  await writeScene(id, scene);

  const updated = await meta.patchDoc(id, {
    sceneVersion,
    updatedAt: Date.now(),
    // A local edit invalidates any previous 'synced' claim.
    syncState: existing.syncState === 'error' ? 'error' : 'local',
  });
  return { saved: true, meta: updated };
}

export async function renameDoc(id: string, title: string): Promise<void> {
  await meta.patchDoc(id, { title: title.trim() || UNTITLED, updatedAt: Date.now() });
}

export async function deleteDoc(id: string): Promise<void> {
  await deleteScene(id);
  await meta.removeDoc(id);
}

/** Imports a .excalidraw file as a new document. */
export async function importDoc(title: string, json: string): Promise<DocMeta> {
  const scene = deserialize(json);
  const doc = await createDoc(title);
  await writeScene(doc.id, scene);
  const updated = await meta.patchDoc(doc.id, {
    sceneVersion: getSceneVersion(scene.elements),
  });
  return updated ?? doc;
}
