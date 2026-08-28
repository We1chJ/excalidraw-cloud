import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SceneData } from '../storage/types';

/**
 * Owns the IndexedDB that holds scene and snapshot bodies.
 *
 * This lives in the service worker rather than the content script on purpose. A
 * content script shares the PAGE's IndexedDB, not the extension's, so storing
 * here from excalidraw.com would put the user's drawings under excalidraw.com's
 * origin -- where clearing that site's data deletes them, where the
 * "unlimitedStorage" permission does not apply because it is extension-scoped,
 * and where the service worker cannot read them at all. Drive sync needs the
 * worker to reach scene bodies, so the worker owns them.
 *
 * The content script talks to this over chrome.runtime messages; src/storage/db.ts
 * is the client for it.
 */

interface StoredSnapshot {
  id: string;
  docId: string;
  takenAt: number;
  scene: SceneData;
}

interface ExcalidrawCloudDB extends DBSchema {
  scenes: { key: string; value: SceneData };
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

export const dbOps = {
  async readScene(id: string): Promise<SceneData | undefined> {
    return (await db()).get('scenes', id);
  },

  async writeScene(id: string, scene: SceneData): Promise<void> {
    await (await db()).put('scenes', scene, id);
  },

  async deleteScene(id: string): Promise<void> {
    await (await db()).delete('scenes', id);
  },

  async putSnapshot(entry: StoredSnapshot): Promise<void> {
    await (await db()).put('snapshots', entry);
  },

  async readSnapshot(id: string): Promise<StoredSnapshot | undefined> {
    return (await db()).get('snapshots', id);
  },

  async deleteSnapshot(id: string): Promise<void> {
    await (await db()).delete('snapshots', id);
  },

  async deleteSnapshotsForDoc(docId: string): Promise<void> {
    const database = await db();
    const tx = database.transaction('snapshots', 'readwrite');
    const keys = await tx.store.index('byDoc').getAllKeys(docId);
    await Promise.all(keys.map((key) => tx.store.delete(key)));
    await tx.done;
  },

  async estimateUsage(): Promise<number | null> {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.usage ?? null;
  },
};

export type DbOp = keyof typeof dbOps;
