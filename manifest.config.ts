import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// Public half of key.pem. Pins the extension ID to
//   ceblkplfjlpkgmioaohkodeibecamilh
// regardless of where the unpacked folder lives. Without this the ID is derived
// from the folder path, and moving the folder breaks the OAuth client binding.
//
// Safe to commit -- it is a public key. key.pem (the private half) is gitignored.
// Forks: regenerate with the commands in docs/google-cloud-setup.md.
const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq8EFHbfY2MR3JcwPZ/V+TmvqXMjG2I6qUiEyM9xrSmtPdNMalN0rE/empRaM9fRugOmy7Q6J3712bL8C/EZDVFqD7uR3VUNwHN989Va6lcrmEpeqGqXsuZsuDJw8FbG4rqgC0W4F2kpiTUhQTFt4hATQehbAhAdZ2KBMO7JVp9nm87IYIgyU6pDVt9BCJpsRt0Sq5PS62gCX5R6YWCJrqMXy+FduDhuPn4kxqihysZ5dGRvc/iLKSmw4lIAfPYFSS5zXH3T+vbHdNB2daE6Oy7w6VoMsLF2IvkHYwQFUSIEW19nhNLPZ1MFCKmropyfD2kyrCd3DlP+FTo1xPx+6ewIDAQAB';

// Google Drive sync activates only when a client ID is configured.
// Without one the extension runs local-only and never asks for permissions
// it cannot use.
const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID ?? '';

export default defineManifest({
  manifest_version: 3,
  name: 'Excalidraw Cloud',
  version: pkg.version,
  description: pkg.description,

  key: KEY,

  action: {
    default_title: 'Open Excalidraw Cloud',
  },

  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  options_page: 'src/options/index.html',

  permissions: [
    'storage',
    'unlimitedStorage',
    ...(GOOGLE_CLIENT_ID ? (['identity'] as const) : []),
  ],

  ...(GOOGLE_CLIENT_ID
    ? {
        host_permissions: ['https://www.googleapis.com/*'],
        oauth2: {
          client_id: GOOGLE_CLIENT_ID,
          scopes: ['https://www.googleapis.com/auth/drive.file'],
        },
      }
    : {}),

  // Excalidraw loads font files at runtime via window.EXCALIDRAW_ASSET_PATH.
  // They must be reachable as extension resources or text renders in a fallback face.
  web_accessible_resources: [
    {
      resources: ['excalidraw-assets/*'],
      matches: ['<all_urls>'],
    },
  ],

  icons: {
    '16': 'icons/icon-16.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
});
