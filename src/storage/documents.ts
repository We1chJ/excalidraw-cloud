import * as db from './db';
import * as meta from './meta';
import { sceneVersionOf } from '../excalidraw/bridge';
import * as sync from './sync';
import type { DocMeta, ExcalidrawFile, SceneData, Snapshot } from './types';

/**
 * Document operations the sidebar calls. Nothing above this file touches
 * IndexedDB or chrome.storage directly.
 */

export const UNTITLED = 'Untitled drawing';

/**
 * How many points in a document's timeline we keep.
 *
 * Snapshots hold whole scenes including embedded images, so an unbounded
 * timeline is how you fill somebody's Drive quota without ever telling them.
 */
export const MAX_SNAPSHOTS = 30;

const newId = () => crypto.randomUUID();

export const listDocs = meta.listDocs;
export const getDoc = meta.getDoc;
export const listSnapshots = meta.listSnapshots;
export const onStoreChanged = meta.onStoreChanged;
export const getActiveDocId = meta.getActiveDocId;
export const setActiveDocId = meta.setActiveDocId;
export const estimateUsage = db.estimateUsage;

/**
 * Builds the canonical .excalidraw payload.
 *
 * Hand-built rather than via serializeAsJSON: importing @excalidraw/excalidraw
 * at runtime would pull the whole editor into the content script. `files` is
 * always populated -- the library's 'database' variant sets it to undefined,
 * which silently drops every embedded image.
 */
export function toExcalidrawFile(scene: SceneData): ExcalidrawFile {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: scene.elements,
    // Only the two fields that describe the drawing itself. Everything else in
    // AppState is editor preference (theme, current tool, viewport) and belongs
    // to whoever opens the file, not to the file.
    appState: {
      viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#ffffff',
      ...(typeof scene.appState.gridSize === 'number'
        ? { gridSize: scene.appState.gridSize }
        : {}),
    },
    files: scene.files ?? {},
  };
}

export function fromExcalidrawFile(json: string): SceneData {
  const parsed = JSON.parse(json) as Partial<ExcalidrawFile>;
  if (!Array.isArray(parsed.elements)) {
    throw new Error('That file does not look like an .excalidraw drawing.');
  }
  return {
    elements: parsed.elements,
    appState: parsed.appState ?? {},
    files: parsed.files ?? {},
  };
}

/** Saves the given scene as a new document, with its first snapshot. */
export async function createDoc(title: string, scene: SceneData): Promise<DocMeta> {
  const now = Date.now();
  const doc: DocMeta = {
    id: newId(),
    title: title.trim() || UNTITLED,
    createdAt: now,
    updatedAt: now,
    sceneVersion: sceneVersionOf(scene.elements),
    elementCount: scene.elements.length,
    syncState: 'local',
  };
  await db.writeScene(doc.id, scene);
  await meta.putDoc(doc);
  await takeSnapshot(doc.id, scene, now);
  sync.pushInBackground(doc.id);
  return doc;
}

export interface SaveResult {
  saved: boolean;
  reason?: string;
  meta?: DocMeta;
}

/**
 * Updates a document from the live canvas and adds a timeline entry.
 *
 * Returns saved:false when nothing changed, so re-saving an untouched canvas
 * does not pile up identical snapshots.
 */
export async function saveDoc(id: string, scene: SceneData): Promise<SaveResult> {
  const existing = await meta.getDoc(id);
  if (!existing) return { saved: false, reason: 'That drawing no longer exists.' };

  const version = sceneVersionOf(scene.elements);
  if (version === existing.sceneVersion) {
    return { saved: false, reason: 'No changes since the last save.' };
  }

  const now = Date.now();
  await db.writeScene(id, scene);
  const updated = await meta.patchDoc(id, {
    sceneVersion: version,
    elementCount: scene.elements.length,
    updatedAt: now,
    syncState: 'local',
  });
  await takeSnapshot(id, scene, now);
  sync.pushInBackground(id);
  return { saved: true, meta: updated };
}

async function takeSnapshot(docId: string, scene: SceneData, takenAt: number): Promise<void> {
  const entry: Snapshot = {
    id: newId(),
    docId,
    takenAt,
    sceneVersion: sceneVersionOf(scene.elements),
    elementCount: scene.elements.length,
  };
  await db.putSnapshot({ id: entry.id, docId, takenAt, scene });

  const existing = await meta.listSnapshots(docId);
  const next = [entry, ...existing];

  // Trim oldest-first, deleting bodies as we go so IndexedDB does not keep
  // scenes the index no longer references.
  const dropped = next.slice(MAX_SNAPSHOTS);
  for (const old of dropped) await db.deleteSnapshot(old.id);
  await meta.setSnapshots(docId, next.slice(0, MAX_SNAPSHOTS));
}

/** The document's current scene. */
export async function loadDoc(id: string): Promise<SceneData> {
  const scene = await db.readScene(id);
  if (!scene) throw new Error('That drawing could not be found on this device.');
  return scene;
}

/** A specific point in a document's timeline. */
export async function loadSnapshot(snapshotId: string): Promise<SceneData> {
  const stored = await db.readSnapshot(snapshotId);
  if (!stored) throw new Error('That version could not be found on this device.');
  return stored.scene;
}

export async function renameDoc(id: string, title: string): Promise<void> {
  const next = title.trim() || UNTITLED;
  await meta.patchDoc(id, { title: next });
  void sync.renameRemote(id, next).catch(() => {});
}

export async function deleteDoc(id: string): Promise<void> {
  // Trash the Drive copy before dropping local state -- afterwards the remoteId
  // is gone and the file would be orphaned in the user's Drive forever.
  await sync.removeRemote(id).catch(() => {});
  await db.deleteScene(id);
  await db.deleteSnapshotsForDoc(id);
  await meta.dropSnapshots(id);
  await meta.removeDoc(id);
}
