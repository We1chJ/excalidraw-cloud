import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';

export interface DocMeta {
  /** Stable local id. Never changes, even after the doc syncs. */
  id: string;
  title: string;
  /** Epoch ms of the last saved change. */
  updatedAt: number;
  createdAt: number;
  /**
   * Cheap change detector. Compared before writing so re-saving an untouched
   * canvas does not create a duplicate snapshot.
   */
  sceneVersion: number;
  elementCount: number;
  /** Remote file id once synced. Opaque -- a Drive fileId today, a path elsewhere. */
  remoteId?: string;
  remoteModifiedAt?: number;
  syncState: SyncState;
  /** Human-readable reason when syncState is 'error'. */
  syncError?: string;
}

/** One point in a document's timeline. */
export interface Snapshot {
  id: string;
  docId: string;
  takenAt: number;
  sceneVersion: number;
  elementCount: number;
}

export interface SceneData {
  elements: readonly OrderedExcalidrawElement[];
  appState: Partial<AppState>;
  /** Embedded images. Dropping this silently destroys every image in the scene. */
  files: BinaryFiles;
}

/**
 * The .excalidraw file format, as excalidraw.com itself writes it.
 *
 * Built by hand rather than via serializeAsJSON, because importing
 * @excalidraw/excalidraw at runtime would pull the whole editor into a content
 * script. `files` must be present and populated -- the 'database' serialization
 * variant omits it, which silently destroys every embedded image.
 */
export interface ExcalidrawFile {
  type: 'excalidraw';
  version: 2;
  source: string;
  elements: readonly OrderedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

/**
 * The seam between the document manager and wherever bytes actually live.
 *
 * Everything above this interface is the sidebar and document manager;
 * everything below is swappable. Adapters deal in whole scenes -- there is no
 * element-level diffing.
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
  /** `body` is a serialised .excalidraw document; adapters are transport, not serialisation. */
  create(title: string, body: string): Promise<{ remoteId: string; modifiedAt: number }>;
  update(remoteId: string, body: string): Promise<{ modifiedAt: number }>;
  rename(remoteId: string, title: string): Promise<void>;
  remove(remoteId: string): Promise<void>;
}

export interface RemoteFile {
  remoteId: string;
  title: string;
  modifiedAt: number;
}
