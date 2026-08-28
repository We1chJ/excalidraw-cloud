import { dbOps, type DbOp } from './storage-host';
import { syncOps, type SyncOp } from './sync';

/**
 * The extension has no page of its own -- the UI is a panel injected into
 * excalidraw.com. The worker routes the toolbar click, owns the IndexedDB that
 * holds scene bodies, and owns everything that touches Google Drive.
 *
 * Both of those live here rather than in the content script for hard reasons:
 * a content script shares the page's IndexedDB rather than the extension's, and
 * MV3 subjects content-script fetches to the page's CORS, so cross-origin calls
 * to googleapis.com have to originate from the worker.
 */

const EXCALIDRAW_ORIGIN = 'https://excalidraw.com';

async function toggleOrOpen(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id !== undefined && tab.url?.startsWith(EXCALIDRAW_ORIGIN)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' });
      return;
    } catch {
      // The content script has not loaded -- usually because the tab predates
      // the extension being installed or reloaded. Reloading injects it.
      await chrome.tabs.reload(tab.id);
      return;
    }
  }
  await chrome.tabs.create({ url: `${EXCALIDRAW_ORIGIN}/` });
}

chrome.action.onClicked.addListener((tab) => void toggleOrOpen(tab));

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void chrome.tabs.create({ url: `${EXCALIDRAW_ORIGIN}/` });
  }
});

interface Request {
  kind: 'db' | 'sync';
  op: string;
  args?: unknown[];
}

function isRequest(msg: unknown): msg is Request {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    ((msg as Request).kind === 'db' || (msg as Request).kind === 'sync') &&
    typeof (msg as Request).op === 'string'
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRequest(message)) return false;

  const table = message.kind === 'db' ? dbOps : syncOps;
  const handler = (table as Record<string, (...args: unknown[]) => Promise<unknown>>)[
    message.op as DbOp | SyncOp
  ];

  if (typeof handler !== 'function') {
    sendResponse({ ok: false, error: `Unknown ${message.kind} operation "${message.op}".` });
    return false;
  }

  handler(...(message.args ?? []))
    .then((value) => sendResponse({ ok: true, value }))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );

  // Keeps the message channel open for the async reply. Without this the port
  // closes immediately and every call rejects.
  return true;
});
