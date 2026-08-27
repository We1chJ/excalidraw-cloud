import type { DocMeta, Snapshot } from './types';

/**
 * The document index lives in chrome.storage.local rather than IndexedDB so the
 * service worker and options page can read it without opening a database, and
 * so every surface gets change events for free.
 *
 * Scene bodies stay in IndexedDB -- they carry embedded images and get large.
 */

const INDEX_KEY = 'docIndex';
const ACTIVE_KEY = 'activeDocId';
const SNAPSHOT_KEY = 'snapshotIndex';

type DocIndex = Record<string, DocMeta>;
type SnapshotIndex = Record<string, Snapshot[]>;

export async function readIndex(): Promise<DocIndex> {
  const result = await chrome.storage.local.get(INDEX_KEY);
  return (result[INDEX_KEY] as DocIndex | undefined) ?? {};
}

export async function listDocs(): Promise<DocMeta[]> {
  const index = await readIndex();
  return Object.values(index).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDoc(id: string): Promise<DocMeta | undefined> {
  return (await readIndex())[id];
}

export async function putDoc(meta: DocMeta): Promise<void> {
  const index = await readIndex();
  index[meta.id] = meta;
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

export async function patchDoc(
  id: string,
  patch: Partial<Omit<DocMeta, 'id'>>,
): Promise<DocMeta | undefined> {
  const index = await readIndex();
  const existing = index[id];
  if (!existing) return undefined;
  const next = { ...existing, ...patch };
  index[id] = next;
  await chrome.storage.local.set({ [INDEX_KEY]: index });
  return next;
}

export async function removeDoc(id: string): Promise<void> {
  const index = await readIndex();
  delete index[id];
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

export async function readSnapshotIndex(): Promise<SnapshotIndex> {
  const result = await chrome.storage.local.get(SNAPSHOT_KEY);
  return (result[SNAPSHOT_KEY] as SnapshotIndex | undefined) ?? {};
}

/** Newest first. */
export async function listSnapshots(docId: string): Promise<Snapshot[]> {
  const index = await readSnapshotIndex();
  return [...(index[docId] ?? [])].sort((a, b) => b.takenAt - a.takenAt);
}

export async function setSnapshots(docId: string, entries: Snapshot[]): Promise<void> {
  const index = await readSnapshotIndex();
  if (entries.length) index[docId] = entries;
  else delete index[docId];
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: index });
}

export async function dropSnapshots(docId: string): Promise<void> {
  const index = await readSnapshotIndex();
  delete index[docId];
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: index });
}

export async function getActiveDocId(): Promise<string | undefined> {
  const result = await chrome.storage.local.get(ACTIVE_KEY);
  return result[ACTIVE_KEY] as string | undefined;
}

export async function setActiveDocId(id: string): Promise<void> {
  await chrome.storage.local.set({ [ACTIVE_KEY]: id });
}

/**
 * Fires whenever the document index or any timeline changes, in any context
 * (an excalidraw.com tab, the options page, the service worker). Two tabs on
 * excalidraw.com stay in step for free.
 */
export function onStoreChanged(listener: () => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local') return;
    if (INDEX_KEY in changes || SNAPSHOT_KEY in changes) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
