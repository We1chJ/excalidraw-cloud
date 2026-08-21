import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';

export interface DocMeta {
  /** Stable local id. Never changes, even after the doc syncs. */
  id: string;
  title: string;
  /** Epoch ms of the last local edit. */
  updatedAt: number;
  createdAt: number;
  /**
   * Excalidraw's scene version. Compared before writing so that pure viewport
   * changes (pan, zoom, selection) don't mark the document dirty.
   */
  sceneVersion: number;
  /** Remote file id once synced. Opaque -- a Drive fileId today, a path elsewhere. */
  remoteId?: string;
  remoteModifiedAt?: number;
  syncState: SyncState;
  /** Human-readable reason when syncState is 'error'. */
  syncError?: string;
}

export interface SceneData {
  elements: readonly OrderedExcalidrawElement[];
  appState: Partial<AppState>;
  /** Embedded images. Dropping this silently destroys every image in the scene. */
  files: BinaryFiles;
}

/**
 * The seam between the document manager and wherever bytes actually live.
 *
 * Everything above this interface is the editor; everything below is swappable.
 * Adapters deal in whole scenes -- there is no element-level diffing.
 */
export interface StorageAdapter {
  readonly id: string;
  /** Shown in the options page, e.g. "Google Drive". */
  readonly label: string;

  isConnected(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  list(): Promise<RemoteFile[]>;
  load(remoteId: string): Promise<SceneData>;
  create(title: string, scene: SceneData): Promise<{ remoteId: string; modifiedAt: number }>;
  update(remoteId: string, scene: SceneData): Promise<{ modifiedAt: number }>;
  remove(remoteId: string): Promise<void>;
}

export interface RemoteFile {
  remoteId: string;
  title: string;
  modifiedAt: number;
}
