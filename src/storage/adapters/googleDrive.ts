import { connect, disconnect, isConfigured, isConnected, withToken } from '../../lib/auth';
import type { RemoteFile, SceneData, StorageAdapter } from '../types';

/**
 * Google Drive, via the REST API. Service-worker side only.
 *
 * Scope is drive.file: access is limited to files this extension itself
 * created, so it can never read the rest of the user's Drive. That also keeps it
 * a non-sensitive scope, which is what avoids Google's verification review.
 *
 * Files are whole .excalidraw documents. Snapshots are deliberately NOT
 * uploaded -- version history stays on the device that made it. Uploading up to
 * 30 whole scenes per drawing, each carrying embedded images, is how you quietly
 * consume somebody's Drive quota.
 */

const FOLDER_NAME = 'Excalidraw';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_MIME = 'application/json';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function asJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;

  const body = await response.text().catch(() => '');
  // Quota exhaustion must not look like a transient failure -- retrying it
  // silently is how a user ends up believing their work is backed up.
  if (response.status === 403 && /quota|storageQuotaExceeded/i.test(body)) {
    throw new Error('Your Google Drive is full. Free up space, then sync again.');
  }
  if (response.status === 404) {
    throw new Error('That drawing is no longer in your Drive.');
  }
  throw new Error(`Google Drive returned ${response.status}. ${body.slice(0, 180)}`);
}

function fileName(title: string): string {
  // Drive tolerates most characters, but slashes read as paths in some clients.
  const safe = title.replace(/[\\/]/g, '-').trim() || 'Untitled drawing';
  return safe.endsWith('.excalidraw') ? safe : `${safe}.excalidraw`;
}

export class GoogleDriveAdapter implements StorageAdapter {
  readonly id = 'google-drive';
  readonly label = 'Google Drive';

  private folderId: string | undefined;

  isConnected = isConnected;
  connect = connect;

  async disconnect(): Promise<void> {
    this.folderId = undefined;
    await disconnect();
  }

  static isConfigured = isConfigured;

  /** Finds the Excalidraw folder, creating it on first use. */
  private async folder(): Promise<string> {
    if (this.folderId) return this.folderId;

    const q = encodeURIComponent(
      `mimeType='${FOLDER_MIME}' and name='${FOLDER_NAME}' and trashed=false`,
    );
    const found = await withToken((token) =>
      fetch(`${API}/files?q=${q}&fields=files(id)&spaces=drive`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ).then((r) => asJson<{ files: { id: string }[] }>(r));

    if (found.files[0]) {
      this.folderId = found.files[0].id;
      return this.folderId;
    }

    const created = await withToken((token) =>
      fetch(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
      }),
    ).then((r) => asJson<{ id: string }>(r));

    this.folderId = created.id;
    return this.folderId;
  }

  async list(): Promise<RemoteFile[]> {
    const folderId = await this.folder();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const result = await withToken((token) =>
      fetch(`${API}/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=200`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ).then((r) => asJson<{ files: { id: string; name: string; modifiedTime: string }[] }>(r));

    return result.files.map((f) => ({
      remoteId: f.id,
      title: f.name.replace(/\.excalidraw$/, ''),
      modifiedAt: Date.parse(f.modifiedTime),
    }));
  }

  async load(remoteId: string): Promise<SceneData> {
    const response = await withToken((token) =>
      fetch(`${API}/files/${remoteId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const file = await asJson<{
      elements?: SceneData['elements'];
      appState?: SceneData['appState'];
      files?: SceneData['files'];
    }>(response);

    if (!Array.isArray(file.elements)) {
      throw new Error('That Drive file is not a valid Excalidraw drawing.');
    }
    return {
      elements: file.elements,
      appState: file.appState ?? {},
      files: file.files ?? {},
    };
  }

  /**
   * Multipart upload: one request carrying both the metadata and the body.
   * Two-step (create then patch) would leave an empty file behind whenever the
   * second call failed.
   */
  async create(title: string, body: string): Promise<{ remoteId: string; modifiedAt: number }> {
    const folderId = await this.folder();
    const boundary = `ec-${crypto.randomUUID()}`;
    const payload =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name: fileName(title), parents: [folderId] })}\r\n` +
      `--${boundary}\r\nContent-Type: ${FILE_MIME}\r\n\r\n${body}\r\n` +
      `--${boundary}--`;

    const result = await withToken((token) =>
      fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: payload,
      }),
    ).then((r) => asJson<{ id: string; modifiedTime: string }>(r));

    return { remoteId: result.id, modifiedAt: Date.parse(result.modifiedTime) };
  }

  async update(remoteId: string, body: string): Promise<{ modifiedAt: number }> {
    const result = await withToken((token) =>
      fetch(`${UPLOAD}/files/${remoteId}?uploadType=media&fields=modifiedTime`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': FILE_MIME },
        body,
      }),
    ).then((r) => asJson<{ modifiedTime: string }>(r));

    return { modifiedAt: Date.parse(result.modifiedTime) };
  }

  async rename(remoteId: string, title: string): Promise<void> {
    await withToken((token) =>
      fetch(`${API}/files/${remoteId}?fields=id`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fileName(title) }),
      }),
    ).then((r) => asJson<{ id: string }>(r));
  }

  async remove(remoteId: string): Promise<void> {
    // Trash rather than hard-delete: a sync bug should be recoverable from the
    // user's own Drive bin, not permanent.
    await withToken((token) =>
      fetch(`${API}/files/${remoteId}?fields=id`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      }),
    ).then((r) => asJson<{ id: string }>(r));
  }
}
