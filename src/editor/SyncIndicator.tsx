import type { DocMeta } from '../storage/types';

const LABEL: Record<DocMeta['syncState'], string> = {
  local: 'Saved on this device',
  syncing: 'Syncing…',
  synced: 'Synced to Drive',
  error: 'Sync failed — retry',
};

export function SyncIndicator({ doc }: { doc: DocMeta }) {
  return (
    <div className={`sync-indicator sync-${doc.syncState}`} title={doc.syncError}>
      <span className="sync-dot" aria-hidden="true" />
      {LABEL[doc.syncState]}
    </div>
  );
}
