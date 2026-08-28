import { GoogleDriveAdapter } from '../storage/adapters/googleDrive';
import { dbOps } from './storage-host';
import type { DocMeta, ExcalidrawFile, SceneData } from '../storage/types';

/**
 * Push-on-save sync, service-worker side.
 *
 * Deliberately not a background queue with debouncing: saves in this extension
 * are explicit user actions ("Save canvas", "Save version"), not an autosave
 * firing on every pointer move, so there is nothing to coalesce. One save, one
 * upload, and the panel shows the outcome.
 *
 * Conflict policy is last-write-wins. That is adequate for one person across
 * their own devices, and the alternative -- a merge UI -- is a large amount of
 * work to resolve a conflict that mostly does not happen.
 */

const drive = new GoogleDriveAdapter();
const INDEX_KEY = 'docIndex';

type DocIndex = Record<string, DocMeta>;

async function readIndex(): Promise<DocIndex> {
  const result = await chrome.storage.local.get(INDEX_KEY);
  return (result[INDEX_KEY] as DocIndex | undefined) ?? {};
}

async function patchDoc(id: string, patch: Partial<DocMeta>): Promise<void> {
  const index = await readIndex();
  const existing = index[id];
  if (!existing) return;
  index[id] = { ...existing, ...patch };
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

/** Serialises a scene into the .excalidraw format Drive stores. */
function serialise(scene: SceneData): string {
  const file: ExcalidrawFile = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: scene.elements,
    appState: {
      viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#ffffff',
    },
    // Always populated. Omitting it is how embedded images get silently lost.
    files: scene.files ?? {},
  };
  return JSON.stringify(file, null, 2);
}

export const syncOps = {
  async status(): Promise<{ configured: boolean; connected: boolean; label: string }> {
    return {
      configured: GoogleDriveAdapter.isConfigured(),
      connected: await drive.isConnected(),
      label: drive.label,
    };
  },

  async connect(): Promise<void> {
    await drive.connect();
  },

  async disconnect(): Promise<void> {
    await drive.disconnect();
    // Clear remote ids: they refer to a Drive account we no longer hold a token
    // for, and keeping them would make a later reconnect try to PATCH files
    // that may belong to a different account.
    const index = await readIndex();
    for (const doc of Object.values(index)) {
      delete doc.remoteId;
      delete doc.remoteModifiedAt;
      doc.syncState = 'local';
      delete doc.syncError;
    }
    await chrome.storage.local.set({ [INDEX_KEY]: index });
  },

  /** Uploads one document's current scene. */
  async push(docId: string): Promise<{ synced: boolean; error?: string }> {
    const index = await readIndex();
    const doc = index[docId];
    if (!doc) return { synced: false, error: 'That drawing no longer exists.' };
    if (!(await drive.isConnected())) return { synced: false, error: 'Not connected to Google Drive.' };

    const scene = await dbOps.readScene(docId);
    if (!scene) return { synced: false, error: 'That drawing has no saved scene.' };

    await patchDoc(docId, { syncState: 'syncing' });
    try {
      const body = serialise(scene);
      const result = doc.remoteId
        ? { ...(await drive.update(doc.remoteId, body)), remoteId: doc.remoteId }
        : await drive.create(doc.title, body);

      await patchDoc(docId, {
        remoteId: result.remoteId,
        remoteModifiedAt: result.modifiedAt,
        syncState: 'synced',
        syncError: undefined,
      });
      return { synced: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Surfaced, never swallowed: silent sync failure is the main risk in a
      // design where the user believes their work is backed up.
      await patchDoc(docId, { syncState: 'error', syncError: message });
      return { synced: false, error: message };
    }
  },

  /** Pushes every document that is not already synced. */
  async pushAll(): Promise<{ pushed: number; failed: number }> {
    const index = await readIndex();
    let pushed = 0;
    let failed = 0;
    for (const doc of Object.values(index)) {
      if (doc.syncState === 'synced') continue;
      const result = await syncOps.push(doc.id);
      if (result.synced) pushed++;
      else failed++;
    }
    return { pushed, failed };
  },

  async renameRemote(docId: string, title: string): Promise<void> {
    const index = await readIndex();
    const doc = index[docId];
    if (!doc?.remoteId || !(await drive.isConnected())) return;
    try {
      await drive.rename(doc.remoteId, title);
    } catch {
      // A failed rename leaves a stale filename in Drive but loses no data, so
      // it is not worth flipping the document into an error state.
    }
  },

  async removeRemote(docId: string): Promise<void> {
    const index = await readIndex();
    const doc = index[docId];
    if (!doc?.remoteId || !(await drive.isConnected())) return;
    await drive.remove(doc.remoteId).catch(() => {});
  },

  /** Drawings in Drive that this device has no local copy of. */
  async listRemoteOnly(): Promise<{ remoteId: string; title: string; modifiedAt: number }[]> {
    if (!(await drive.isConnected())) return [];
    const index = await readIndex();
    const known = new Set(
      Object.values(index)
        .map((d) => d.remoteId)
        .filter(Boolean) as string[],
    );
    const remote = await drive.list();
    return remote.filter((f) => !known.has(f.remoteId));
  },

  async pull(remoteId: string): Promise<SceneData> {
    return drive.load(remoteId);
  },
};

export type SyncOp = keyof typeof syncOps;
