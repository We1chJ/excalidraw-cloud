import { useCallback, useEffect, useState } from 'react';
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
import type { DocMeta, SceneData, Snapshot } from '../storage/types';

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

/** A load that would overwrite the canvas, held until the user confirms. */
interface PendingLoad {
  label: string;
  scene: () => Promise<SceneData>;
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

  const refresh = useCallback(async () => {
    setDocs(await listDocs());
  }, []);

  useEffect(() => {
    setHealth(checkHealth());
    void refresh();
    return onStoreChanged(() => void refresh());
  }, [refresh]);

  // The toolbar button toggles the panel; there is no other UI entry point.
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

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000);
  };

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

  /** Loads only after confirmation, because it replaces the canvas and reloads. */
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
            extension reads excalidraw.com&rsquo;s local storage directly, which
            is not a published API.
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
          {docs.map((doc) => (
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
                    onClick={() => setExpanded(expanded === doc.id ? null : doc.id)}
                    aria-expanded={expanded === doc.id}
                  >
                    <span className="chev" aria-hidden="true">
                      {expanded === doc.id ? '▾' : '▸'}
                    </span>
                    <span className="name">{doc.title}</span>
                    <span className="meta">
                      {doc.elementCount} items · {relativeTime(doc.updatedAt)}
                    </span>
                  </button>
                )}
              </div>

              {/* Always rendered, never hover-gated: hiding controls behind
                  :hover removes them from the accessibility tree entirely. */}
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
                  {snapshots.map((snap, i) => (
                    <li key={snap.id}>
                      <span className="when">
                        {i === 0 ? 'Latest' : relativeTime(snap.takenAt)}
                      </span>
                      <span className="dim">{snap.elementCount} items</span>
                      <button
                        className="link"
                        disabled={!health.ok}
                        onClick={() =>
                          requestLoad(
                            `${doc.title} — ${relativeTime(snap.takenAt)}`,
                            () => loadSnapshot(snap.id),
                          )
                        }
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="foot">
        <button className="link" onClick={() => chrome.runtime.openOptionsPage()}>
          Settings
        </button>
        <span className="dim">Saved on this device</span>
      </footer>
    </aside>
  );
}
