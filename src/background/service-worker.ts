/**
 * The editor lives in a full tab, not the action popup -- popups cap out around
 * 800x600, which is unusable for a canvas.
 *
 * Phase 4 adds the sync queue and chrome.alarms tick here.
 */

const EDITOR_PATH = 'src/editor/index.html';
const TAB_KEY = 'editorTabId';

function editorUrl(): string {
  return chrome.runtime.getURL(EDITOR_PATH);
}

/**
 * Remembers the editor tab so clicking the toolbar icon focuses it instead of
 * piling up duplicates, each holding its own unsaved state.
 *
 * The obvious implementation is chrome.tabs.query({ url }), but the url filter
 * requires the "tabs" permission, which prompts the user with "read your
 * browsing history" at install. Tracking the id ourselves needs no permission.
 */
async function focusExistingEditor(): Promise<boolean> {
  const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
  if (typeof tabId !== 'number') return false;

  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return true;
  } catch {
    // Tab was closed since we recorded it.
    await chrome.storage.session.remove(TAB_KEY);
    return false;
  }
}

async function openEditor(): Promise<void> {
  if (await focusExistingEditor()) return;
  const tab = await chrome.tabs.create({ url: editorUrl() });
  if (tab.id !== undefined) {
    await chrome.storage.session.set({ [TAB_KEY]: tab.id });
  }
}

chrome.action.onClicked.addListener(() => void openEditor());

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void openEditor();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.get(TAB_KEY).then(({ [TAB_KEY]: known }) => {
    if (known === tabId) void chrome.storage.session.remove(TAB_KEY);
  });
});
