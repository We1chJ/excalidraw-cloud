import type { DocMeta } from './types';

/**
 * The document index lives in chrome.storage.local rather than IndexedDB so the
 * service worker and options page can read it without opening a database, and
 * so every surface gets change events for free.
 *
 * Scene bodies stay in IndexedDB -- they carry embedded images and get large.
 */

const INDEX_KEY = 'docIndex';
const ACTIVE_KEY = 'activeDocId';

type DocIndex = Record<string, DocMeta>;

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

export async function getActiveDocId(): Promise<string | undefined> {
  const result = await chrome.storage.local.get(ACTIVE_KEY);
  return result[ACTIVE_KEY] as string | undefined;
}

export async function setActiveDocId(id: string): Promise<void> {
  await chrome.storage.local.set({ [ACTIVE_KEY]: id });
}

/** Fires whenever the index changes in any context (tab, options page, worker). */
export function onIndexChanged(listener: (docs: DocMeta[]) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local' || !(INDEX_KEY in changes)) return;
    const next = (changes[INDEX_KEY]?.newValue as DocIndex | undefined) ?? {};
    listener(Object.values(next).sort((a, b) => b.updatedAt - a.updatedAt));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
