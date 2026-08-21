import { useEffect, useRef, useState } from 'react';
import type { DocMeta } from '../storage/types';

interface Props {
  docs: DocMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function relativeTime(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString();
}

export function DocumentSidebar({
  docs,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Two-step delete rather than window.confirm, which would block the page.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  const startRename = (doc: DocMeta) => {
    setEditingId(doc.id);
    setDraft(doc.title);
  };

  const commitRename = () => {
    if (editingId) onRename(editingId, draft);
    setEditingId(null);
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <h1 className="sidebar-title">Drawings</h1>
        <button className="btn-primary" onClick={onCreate}>
          New
        </button>
      </header>

      {docs.length === 0 ? (
        <p className="empty-state">No drawings yet. Create one to get started.</p>
      ) : (
        <ul className="doc-list">
          {docs.map((doc) => (
            <li key={doc.id}>
              <div
                className={`doc-item${doc.id === activeId ? ' is-active' : ''}`}
                onClick={() => doc.id !== editingId && onSelect(doc.id)}
                onDoubleClick={() => startRename(doc)}
              >
                {editingId === doc.id ? (
                  <input
                    ref={inputRef}
                    className="doc-rename"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    <span className="doc-name">{doc.title}</span>
                    <span className="doc-time">{relativeTime(doc.updatedAt)}</span>
                  </>
                )}
              </div>

              {confirmingId === doc.id ? (
                <div className="doc-confirm">
                  <span>Delete “{doc.title}”?</span>
                  <button
                    className="btn-danger"
                    onClick={() => {
                      onDelete(doc.id);
                      setConfirmingId(null);
                    }}
                  >
                    Delete
                  </button>
                  <button className="btn-quiet" onClick={() => setConfirmingId(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <div className="doc-actions">
                  <button className="btn-quiet" onClick={() => startRename(doc)}>
                    Rename
                  </button>
                  <button className="btn-quiet" onClick={() => setConfirmingId(doc.id)}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="sidebar-footer">
        <button
          className="btn-quiet"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </footer>
    </aside>
  );
}
