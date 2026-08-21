import type { RemoteFile, SceneData, StorageAdapter } from '../types';

/**
 * The no-op adapter. Everything already lives in IndexedDB, so there is nothing
 * to push anywhere.
 *
 * It exists so the editor has exactly one code path whether or not a cloud
 * backend is configured -- the UI never branches on "is sync set up".
 */
export class LocalOnlyAdapter implements StorageAdapter {
  readonly id = 'local';
  readonly label = 'This device only';

  async isConnected(): Promise<boolean> {
    return false;
  }

  async connect(): Promise<void> {
    // Nothing to connect to.
  }

  async disconnect(): Promise<void> {
    // Nothing to disconnect from.
  }

  async list(): Promise<RemoteFile[]> {
    return [];
  }

  async load(): Promise<SceneData> {
    throw new Error('Local-only storage has no remote copy to load.');
  }

  async create(): Promise<{ remoteId: string; modifiedAt: number }> {
    throw new Error('Connect a cloud backend to sync drawings off this device.');
  }

  async update(): Promise<{ modifiedAt: number }> {
    throw new Error('Connect a cloud backend to sync drawings off this device.');
  }

  async remove(): Promise<void> {
    // Nothing remote to delete.
  }
}
