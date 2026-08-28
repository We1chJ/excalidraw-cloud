import type { SceneData } from './types';

/**
 * Client for the IndexedDB the service worker owns.
 *
 * The bodies deliberately do not live here. A content script shares the PAGE's
 * IndexedDB, so keeping them locally would store the user's drawings under
 * excalidraw.com's origin -- wiped by clearing that site's data, outside the
 * reach of the extension-scoped "unlimitedStorage" permission, and invisible to
 * the service worker that has to upload them. See src/background/storage-host.ts.
 *
 * Every call is a message round trip, which is why the panel caches scenes for
 * previews rather than re-reading per hover.
 */

interface StoredSnapshot {
  id: string;
  docId: string;
  takenAt: number;
  scene: SceneData;
}

async function call<T>(op: string, args: unknown[] = []): Promise<T> {
  const reply = (await chrome.runtime.sendMessage({ kind: 'db', op, args })) as
    | { ok: true; value: T }
    | { ok: false; error: string }
    | undefined;

  if (!reply) {
    // The worker was asleep and failed to wake, or the extension was reloaded
    // out from under this page.
    throw new Error('Lost contact with the extension. Reload the page and try again.');
  }
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export const readScene = (id: string) => call<SceneData | undefined>('readScene', [id]);
export const writeScene = (id: string, scene: SceneData) => call<void>('writeScene', [id, scene]);
export const deleteScene = (id: string) => call<void>('deleteScene', [id]);

export const putSnapshot = (entry: StoredSnapshot) => call<void>('putSnapshot', [entry]);
export const readSnapshot = (id: string) => call<StoredSnapshot | undefined>('readSnapshot', [id]);
export const deleteSnapshot = (id: string) => call<void>('deleteSnapshot', [id]);
export const deleteSnapshotsForDoc = (docId: string) =>
  call<void>('deleteSnapshotsForDoc', [docId]);

export const estimateUsage = () => call<number | null>('estimateUsage');
