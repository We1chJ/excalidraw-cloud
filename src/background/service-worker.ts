/**
 * The extension has no page of its own -- the UI is a panel injected into
 * excalidraw.com. All this does is route the toolbar click to the right tab.
 *
 * Phase: Drive sync will add the sync queue and a chrome.alarms tick here.
 */

const EXCALIDRAW_ORIGIN = 'https://excalidraw.com';

async function toggleOrOpen(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id !== undefined && tab.url?.startsWith(EXCALIDRAW_ORIGIN)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' });
      return;
    } catch {
      // The content script has not loaded yet -- most often because the tab was
      // already open when the extension was installed or reloaded. Reloading
      // injects it.
      await chrome.tabs.reload(tab.id);
      return;
    }
  }

  // Clicked anywhere else: the extension only does anything on excalidraw.com,
  // so take the user there rather than silently doing nothing.
  await chrome.tabs.create({ url: `${EXCALIDRAW_ORIGIN}/` });
}

chrome.action.onClicked.addListener((tab) => void toggleOrOpen(tab));

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void chrome.tabs.create({ url: `${EXCALIDRAW_ORIGIN}/` });
  }
});
