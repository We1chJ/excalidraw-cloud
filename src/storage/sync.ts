import type { SceneData } from './types';

/**
 * Client for the sync operations the service worker owns.
 *
 * Content scripts cannot call chrome.identity, and MV3 subjects their fetches
 * to the page's CORS, so everything touching Google Drive happens in the worker
 * and the panel talks to it over messages.
 */

async function call<T>(op: string, args: unknown[] = []): Promise<T> {
  const reply = (await chrome.runtime.sendMessage({ kind: 'sync', op, args })) as
    | { ok: true; value: T }
    | { ok: false; error: string }
    | undefined;

  if (!reply) throw new Error('Lost contact with the extension. Reload the page and try again.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export interface SyncStatus {
  configured: boolean;
  connected: boolean;
  label: string;
}

export const status = () => call<SyncStatus>('status');
export const connect = () => call<void>('connect');
export const disconnect = () => call<void>('disconnect');

export const push = (docId: string) => call<{ synced: boolean; error?: string }>('push', [docId]);
export const pushAll = () => call<{ pushed: number; failed: number }>('pushAll');

export const renameRemote = (docId: string, title: string) =>
  call<void>('renameRemote', [docId, title]);
export const removeRemote = (docId: string) => call<void>('removeRemote', [docId]);

export const listRemoteOnly = () =>
  call<{ remoteId: string; title: string; modifiedAt: number }[]>('listRemoteOnly');
export const pull = (remoteId: string) => call<SceneData>('pull', [remoteId]);

/**
 * Fires a sync without making the caller wait or handle failure.
 *
 * The outcome lands in the document index as syncState, which every surface is
 * already subscribed to, so the UI updates itself. Failures are recorded there
 * rather than thrown away -- silent sync failure is the main risk in a design
 * where the user believes their work is backed up.
 */
export function pushInBackground(docId: string): void {
  void push(docId).catch(() => {});
}
