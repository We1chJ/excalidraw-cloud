import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { debounce } from '../lib/debounce';
import {
  createDoc,
  deleteDoc,
  getActiveDocId,
  listDocs,
  loadScene,
  onIndexChanged,
  renameDoc,
  saveScene,
  setActiveDocId,
} from '../storage/documents';
import type { DocMeta, SceneData } from '../storage/types';
import { DocumentSidebar } from './DocumentSidebar';
import { ExcalidrawPane } from './ExcalidrawPane';

/**
 * onChange fires on every pointer move during a drag. 800ms is long enough that
 * a continuous stroke produces one write instead of hundreds, and short enough
 * that closing the tab right after drawing doesn't lose work.
 */
const SAVE_DEBOUNCE_MS = 800;

export function App() {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [active, setActive] = useState<{ doc: DocMeta; scene: SceneData } | null>(null);
  const [booting, setBooting] = useState(true);

  // onChange closes over whatever document is open at the time it fires, so the
  // id has to come from a ref rather than from render state.
  const activeIdRef = useRef<string | null>(null);

  const save = useMemo(
    () =>
      debounce(
        (
          id: string,
          elements: readonly OrderedExcalidrawElement[],
          appState: Partial<AppState>,
          files: BinaryFiles,
        ) => {
          void saveScene(id, elements, appState, files);
        },
        SAVE_DEBOUNCE_MS,
      ),
    [],
  );

  const open = useCallback(
    async (id: string) => {
      // Any edit still sitting in the debounce belongs to the document being
      // navigated away from. Write it before the switch.
      save.flush();

      const list = await listDocs();
      const doc = list.find((d) => d.id === id);
      if (!doc) return;

      const scene = await loadScene(id);
      activeIdRef.current = id;
      setActive({ doc, scene });
      await setActiveDocId(id);
    },
    [save],
  );

  useEffect(() => {
    void (async () => {
      let list = await listDocs();
      if (list.length === 0) {
        await createDoc();
        list = await listDocs();
      }
      setDocs(list);

      const stored = await getActiveDocId();
      const id = stored && list.some((d) => d.id === stored) ? stored : list[0]?.id;
      if (id) await open(id);
      setBooting(false);
    })();
  }, [open]);

  useEffect(() => onIndexChanged(setDocs), []);

  // Keep the open document's metadata (title, sync state) in step with the
  // index without reloading its scene.
  useEffect(() => {
    setActive((current) => {
      if (!current) return current;
      const fresh = docs.find((d) => d.id === current.doc.id);
      return fresh && fresh !== current.doc ? { ...current, doc: fresh } : current;
    });
  }, [docs]);

  // A tab close or a switch to another tab should not sit on unsaved work.
  useEffect(() => {
    const flush = () => save.flush();
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHidden);
      save.flush();
    };
  }, [save]);

  const handleChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const id = activeIdRef.current;
      if (id) save(id, elements, appState, files);
    },
    [save],
  );

  const handleCreate = useCallback(async () => {
    const doc = await createDoc();
    setDocs(await listDocs());
    await open(doc.id);
  }, [open]);

  const handleRename = useCallback(async (id: string, title: string) => {
    await renameDoc(id, title);
    setDocs(await listDocs());
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) save.cancel();
      await deleteDoc(id);

      let list = await listDocs();
      if (list.length === 0) {
        await createDoc();
        list = await listDocs();
      }
      setDocs(list);

      if (id === activeIdRef.current) {
        const next = list[0];
        if (next) await open(next.id);
      }
    },
    [open, save],
  );

  return (
    <div className="app">
      <DocumentSidebar
        docs={docs}
        activeId={active?.doc.id ?? null}
        onSelect={(id) => void open(id)}
        onCreate={() => void handleCreate()}
        onRename={(id, title) => void handleRename(id, title)}
        onDelete={(id) => void handleDelete(id)}
      />
      {active ? (
        <ExcalidrawPane
          doc={active.doc}
          scene={active.scene}
          onChange={handleChange}
          onNewDoc={() => void handleCreate()}
        />
      ) : (
        <div className="canvas-pane canvas-placeholder">
          {booting ? 'Loading…' : 'Select a drawing.'}
        </div>
      )}
    </div>
  );
}
