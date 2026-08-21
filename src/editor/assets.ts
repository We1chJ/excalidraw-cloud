/**
 * Points Excalidraw at the fonts bundled inside the extension.
 *
 * Must be evaluated before Excalidraw resolves any font URL. main.tsx imports
 * this module first; ES modules evaluate in import order, so it wins as long as
 * this file itself imports nothing from Excalidraw.
 *
 * The path is the directory CONTAINING `fonts/`, not the font files themselves --
 * Excalidraw resolves `./fonts/Excalifont/...` relative to it.
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
    EXCALIDRAW_EXPORT_SOURCE?: string;
  }
}

window.EXCALIDRAW_ASSET_PATH = chrome.runtime.getURL('excalidraw-assets/');

// Stamped into the `source` field of every .excalidraw file this extension
// writes. Without it the field would read `chrome-extension://<id>`.
window.EXCALIDRAW_EXPORT_SOURCE = 'excalidraw-cloud';

export {};
