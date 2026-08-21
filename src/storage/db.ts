import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SceneData } from './types';

interface ExcalidrawCloudDB extends DBSchema {
  scenes: {
    key: string; // DocMeta.id
    value: SceneData;
  };
}

const DB_NAME = 'excalidraw-cloud';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ExcalidrawCloudDB>> | undefined;

function db() {
  dbPromise ??= openDB<ExcalidrawCloudDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('scenes')) {
        database.createObjectStore('scenes');
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
