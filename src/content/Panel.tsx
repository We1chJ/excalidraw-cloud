import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkHealth,
  hasContent,
  readScene,
  reload,
  writeScene,
  type Health,
} from '../excalidraw/bridge';
import {
  createDoc,
  deleteDoc,
  listDocs,
  listSnapshots,
  loadDoc,
  loadSnapshot,
  onStoreChanged,
  renameDoc,
  saveDoc,
} from '../storage/documents';
import * as sync from '../storage/sync';
import type { DocMeta, SceneData, Snapshot } from '../storage/types';
import { ScenePreview } from './ScenePreview';

const SYNC_LABEL: Record<DocMeta['syncState'], string> = {
  local: 'not synced',
  syncing: 'syncing…',
  synced: 'synced',
  error: 'sync failed',
};

/** Long enough that sweeping the cursor down the list loads nothing. */
const HOVER_DELAY_MS = 180;

function relativeTime(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

interface PendingLoad {
  label: string;
  scene: () => Promise<SceneData>;
}

interface Preview {
  key: string;
  label: string;
  scene: SceneData;
  top: number;
  pinned: boolean;
}

export function Panel() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health>({ ok: true });
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [pending, setPending] = useState<PendingLoad | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cloud, setCloud] = useState<sync.SyncStatus | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Scenes carry embedded images, so re-reading IndexedDB on every hover would
  // be wasteful. Cleared whenever the store changes so previews cannot go stale.
  const sceneCache = useRef(new Map<string, SceneData>());
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    sceneCache.current.clear();
    setDocs(await listDocs());
  }, []);

  useEffect(() => {
    setHealth(checkHealth());
    void refresh();
    void sync.status().then(setCloud).catch(() => setCloud(null));
    return onStoreChanged(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    const handler = (msg: unknown) => {
      if (typeof msg === 'object' && msg && (msg as { type?: string }).type === 'toggle-panel') {
        setOpen((v) => !v);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  useEffect(() => {
    if (!expanded) {
      setSnapshots([]);
      return;
    }
    void listSnapshots(expanded).then(setSnapshots);
  }, [expanded, docs]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000);
  };

  // ---- preview ------------------------------------------------------------

  const loadPreviewScene = useCallback(
    async (key: string, loader: () => Promise<SceneData>): Promise<SceneData> => {
      const hit = sceneCache.current.get(key);
      if (hit) return hit;
      const scene = await loader();
      sceneCache.current.set(key, scene);
      return scene;
    },
    [],
  );

  const showPreview = useCallback(
    (
      key: string,
      label: string,
      loader: () => Promise<SceneData>,
      anchor: HTMLElement,
      pinned: boolean,
    ) => {
      clearTimeout(hoverTimer.current);
      const rect = anchor.getBoundingClientRect();
      const run = async () => {
        try {
          const scene = await loadPreviewScene(key, loader);
          // Keep the card on screen when hovering a row near the bottom.
          const top = Math.min(Math.max(12, rect.top - 20), window.innerHeight - 210);
          setPreview({ key, label, scene, top, pinned });
        } catch {
          setPreview(null);
        }
      };
      if (pinned) void run();
      else hoverTimer.current = setTimeout(() => void run(), HOVER_DELAY_MS);
    },
    [loadPreviewScene],
  );

  const hidePreview = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setPreview((p) => (p?.pinned ? p : null));
  }, []);

  const previewProps = (
    key: string,
    label: string,
    loader: () => Promise<SceneData>,
  ) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
      showPreview(key, label, loader, e.currentTarget, false),
    onMouseLeave: hidePreview,
    onFocus: (e: React.FocusEvent<HTMLElement>) =>
      showPreview(key, label, loader, e.currentTarget, false),
    onBlur: hidePreview,
  });

  // ---- actions ------------------------------------------------------------

  const saveCurrent = async () => {
    const scene = await readScene();
    if (scene.elements.length === 0) {
      flash('The canvas is empty — draw something first.');
      return;
    }
    const doc = await createDoc(`Drawing ${docs.length + 1}`, scene);
    await refresh();
    setRenaming(doc.id);
    setDraft(doc.title);
  };

  const updateDoc = async (doc: DocMeta) => {
    const scene = await readScene();
    const result = await saveDoc(doc.id, scene);
    await refresh();
    flash(result.saved ? `Saved a new version of “${doc.title}”.` : (result.reason ?? 'Nothing to save.'));
  };

  const requestLoad = (label: string, scene: () => Promise<SceneData>) => {
    if (!hasContent()) {
      void applyLoad({ label, scene });
      return;
    }
    setPending({ label, scene });
  };

  const applyLoad = async (load: PendingLoad) => {
    setPending(null);
    try {
      writeScene(await load.scene());
      // A running excalidraw.com never re-reads localStorage, so the reload is
      // not optional -- it is the mechanism.
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  };

  const connectDrive = async () => {
    setConnecting(true);
    try {
      await sync.connect();
      setCloud(await sync.status());
      // Anything saved before connecting has never been uploaded.
      const { pushed, failed } = await sync.pushAll();
      flash(
        failed
          ? `Connected. Uploaded ${pushed}, ${failed} failed — see the drawing list.`
          : `Connected to Google Drive. Uploaded ${pushed} drawing${pushed === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  const commitRename = async () => {
    if (renaming) {
      await renameDoc(renaming, draft);
      await refresh();
    }
    setRenaming(null);
  };

  if (!open) {
    return (
      <button className="tab" onClick={() => setOpen(true)} title="Excalidraw Cloud">
        <span className="tab-mark" aria-hidden="true" />
      </button>
    );
  }

  return (
    <>
      {preview && (
        <div
          className={preview.pinned ? 'preview-card pinned' : 'preview-card'}
          style={{ top: preview.top }}
          onMouseEnter={() => clearTimeout(hoverTimer.current)}
          onMouseLeave={hidePreview}
        >
          <div className="preview-head">
            <span className="preview-label">{preview.label}</span>
            {preview.pinned && (
              <button className="icon small" onClick={() => setPreview(null)} title="Close preview">
                ×
              </button>
            )}
          </div>
          <ScenePreview scene={preview.scene} />
        </div>
      )}

      <aside className="panel">
        <header className="head">
          <h1>Drawings</h1>
          <div className="head-actions">
            <button className="btn" onClick={() => void saveCurrent()} disabled={!health.ok}>
              Save canvas
            </button>
            <button className="icon" onClick={() => setOpen(false)} title="Close">
              ×
            </button>
          </div>
        </header>

        {!health.ok && (
          <div className="alert">
            <strong>Excalidraw&rsquo;s storage format changed.</strong>
            <p>{health.reason}</p>
            <p>
              Saving and loading are disabled so nothing gets corrupted. This
              extension reads excalidraw.com&rsquo;s local storage directly,
              which is not a published API.
            </p>
          </div>
        )}

        {notice && <div className="notice">{notice}</div>}

        {pending && (
          <div className="confirm">
            <p>
              Loading <strong>{pending.label}</strong> replaces everything on the
              canvas and reloads the page.
            </p>
            <p className="dim">Save the current canvas first if you want to keep it.</p>
            <div className="confirm-actions">
              <button className="btn danger" onClick={() => void applyLoad(pending)}>
                Replace canvas
              </button>
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {docs.length === 0 ? (
          <p className="empty">
            No drawings saved yet. Draw something, then choose <em>Save canvas</em>.
          </p>
        ) : (
          <ul className="docs">
            {docs.map((doc) => {
              const docKey = `doc:${doc.id}`;
              return (
                <li key={doc.id} className={expanded === doc.id ? 'doc open' : 'doc'}>
                  <div className="doc-head">
                    {renaming === doc.id ? (
                      <input
                        className="rename"
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => void commitRename()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : (
                      <button
                        className="doc-title"
                        aria-expanded={expanded === doc.id}
                        {...previewProps(docKey, doc.title, () => loadDoc(doc.id))}
                        onClick={(e) => {
                          setExpanded(expanded === doc.id ? null : doc.id);
                          // Clicking pins the preview so it survives the cursor
                          // leaving the row.
                          showPreview(docKey, doc.title, () => loadDoc(doc.id), e.currentTarget, true);
                        }}
                      >
                        <span className="chev" aria-hidden="true">
                          {expanded === doc.id ? '▾' : '▸'}
                        </span>
                        <span className="name">{doc.title}</span>
                        <span className="meta">
                          {doc.elementCount} items · {relativeTime(doc.updatedAt)}
                          {cloud?.connected && (
                            <span
                              className={`chip chip-${doc.syncState}`}
                              title={doc.syncError ?? undefined}
                            >
                              {SYNC_LABEL[doc.syncState]}
                            </span>
                          )}
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Always rendered, never hover-gated: visibility:hidden would
                      remove these from the accessibility tree entirely. */}
                  <div className="doc-actions">
                    <button
                      className="link"
                      onClick={() => requestLoad(doc.title, () => loadDoc(doc.id))}
                      disabled={!health.ok}
                    >
                      Open
                    </button>
                    <button className="link" onClick={() => void updateDoc(doc)} disabled={!health.ok}>
                      Save version
                    </button>
                    <button
                      className="link"
                      onClick={() => {
                        setRenaming(doc.id);
                        setDraft(doc.title);
                      }}
                    >
                      Rename
                    </button>
                    {confirmDelete === doc.id ? (
                      <>
                        <button
                          className="link danger"
                          onClick={async () => {
                            await deleteDoc(doc.id);
                            setConfirmDelete(null);
                            if (expanded === doc.id) setExpanded(null);
                            setPreview(null);
                            await refresh();
                          }}
                        >
                          Delete for good
                        </button>
                        <button className="link" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button className="link" onClick={() => setConfirmDelete(doc.id)}>
                        Delete
                      </button>
                    )}
                  </div>

                  {expanded === doc.id && (
                    <ol className="history">
                      {snapshots.length === 0 && <li className="dim">No versions yet.</li>}
                      {snapshots.map((snap, i) => {
                        const when = i === 0 ? 'Latest' : relativeTime(snap.takenAt);
                        const key = `snap:${snap.id}`;
                        const label = `${doc.title} — ${when}`;
                        const loader = () => loadSnapshot(snap.id);
                        return (
                          <li key={snap.id}>
                            <button
                              className="snap"
                              title={new Date(snap.takenAt).toLocaleString()}
                              {...previewProps(key, label, loader)}
                              onClick={(e) => showPreview(key, label, loader, e.currentTarget, true)}
                            >
                              <span className="when">{when}</span>
                              <span className="dim">{snap.elementCount} items</span>
                            </button>
                            <button
                              className="link"
                              disabled={!health.ok}
                              onClick={() => requestLoad(label, loader)}
                            >
                              Restore
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <footer className="foot">
          <button className="link" onClick={() => chrome.runtime.openOptionsPage()}>
            Settings
          </button>
          {cloud?.connected ? (
            <span className="dim">Syncing to {cloud.label}</span>
          ) : cloud?.configured ? (
            <button className="link" onClick={() => void connectDrive()} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect Google Drive'}
            </button>
          ) : (
            <span className="dim" title="Add VITE_GOOGLE_CLIENT_ID to .env and rebuild">
              Saved on this device
            </span>
          )}
        </footer>
      </aside>
    </>
  );
}
