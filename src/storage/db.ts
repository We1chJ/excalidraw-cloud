import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SceneData } from './types';

interface StoredSnapshot {
  id: string;
  docId: string;
  takenAt: number;
  scene: SceneData;
}

interface ExcalidrawCloudDB extends DBSchema {
  /** Current state of each document, keyed by DocMeta.id. */
  scenes: {
    key: string;
    value: SceneData;
  };
  /** Timeline entries. Bodies live here; the index in chrome.storage stays small. */
  snapshots: {
    key: string;
    value: StoredSnapshot;
    indexes: { byDoc: string };
  };
}

const DB_NAME = 'excalidraw-cloud';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<ExcalidrawCloudDB>> | undefined;

function db() {
  dbPromise ??= openDB<ExcalidrawCloudDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1 && !database.objectStoreNames.contains('scenes')) {
        database.createObjectStore('scenes');
      }
      if (oldVersion < 2 && !database.objectStoreNames.contains('snapshots')) {
        const store = database.createObjectStore('snapshots', { keyPath: 'id' });
        store.createIndex('byDoc', 'docId');
      }
    },
  });
  return dbPromise;
}

export async function readScene(id: string): Promise<SceneData | undefined> {
  return (await db()).get('scenes', id);
}

export async function writeScene(id: string, scene: SceneData): Promise<void> {
  await (await db()).put('scenes', scene, id);
}

export async function deleteScene(id: string): Promise<void> {
  await (await db()).delete('scenes', id);
}

export async function putSnapshot(entry: StoredSnapshot): Promise<void> {
  await (await db()).put('snapshots', entry);
}

export async function readSnapshot(id: string): Promise<StoredSnapshot | undefined> {
  return (await db()).get('snapshots', id);
}

export async function deleteSnapshot(id: string): Promise<void> {
  await (await db()).delete('snapshots', id);
}

/** Removes every snapshot belonging to a document. Used when deleting it. */
export async function deleteSnapshotsForDoc(docId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction('snapshots', 'readwrite');
  const keys = await tx.store.index('byDoc').getAllKeys(docId);
  await Promise.all(keys.map((key) => tx.store.delete(key)));
  await tx.done;
}

export async function estimateUsage(): Promise<number | null> {
  const estimate = await navigator.storage?.estimate?.();
  return estimate?.usage ?? null;
}
