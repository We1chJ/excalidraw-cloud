import { useEffect, useState } from 'react';
import { listDocs } from '../storage/documents';

interface Manifest extends chrome.runtime.ManifestV3 {
  oauth2?: { client_id: string; scopes: string[] };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function Options() {
  const manifest = chrome.runtime.getManifest() as Manifest;
  const clientId = manifest.oauth2?.client_id ?? '';
  const extensionId = chrome.runtime.id;

  const [docCount, setDocCount] = useState<number | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void listDocs().then((docs) => setDocCount(docs.length));
    void navigator.storage?.estimate?.().then((e) => setUsage(e.usage ?? null));
  }, []);

  const copyId = async () => {
    await navigator.clipboard.writeText(extensionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="page">
      <h1>Excalidraw Cloud</h1>
      <p className="lede">
        Your drawings are stored on this device. Connect a cloud backend to reach
        them from anywhere.
      </p>

      <section className="card">
        <h2>Storage</h2>
        <dl className="facts">
          <div>
            <dt>Location</dt>
            <dd>This device only</dd>
          </div>
          <div>
            <dt>Drawings</dt>
            <dd>{docCount ?? '…'}</dd>
          </div>
          <div>
            <dt>Space used</dt>
            <dd>{usage === null ? '…' : formatBytes(usage)}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <h2>Google Drive</h2>
        {clientId ? (
          <>
            <p className="status status-ready">
              This build has an OAuth client configured.
            </p>
            <p className="muted mono">{clientId}</p>
            <p className="muted">
              Sync is not wired up yet — that lands with the Drive adapter.
            </p>
          </>
        ) : (
          <>
            <p className="status status-pending">Not configured in this build.</p>
            <p>
              Drive sync needs an OAuth client ID from a Google Cloud project.
              Create one, then put it in <code>.env</code> as{' '}
              <code>VITE_GOOGLE_CLIENT_ID</code> and rebuild.
            </p>
            <p className="muted">
              The client ID is not a secret — extensions ship theirs in the bundle
              by design, and there is no client secret.
            </p>
          </>
        )}

        <div className="ext-id">
          <span className="muted">
            The Cloud console asks for this extension&rsquo;s ID:
          </span>
          <div className="ext-id-row">
            <code className="mono">{extensionId}</code>
            <button className="btn" onClick={() => void copyId()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </section>

      <p className="footnote">
        Setup steps are in <code>docs/google-cloud-setup.md</code>.
      </p>
    </main>
  );
}
