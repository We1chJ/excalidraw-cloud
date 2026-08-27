import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// Public half of key.pem. Pins the extension ID to
//   ceblkplfjlpkgmioaohkodeibecamilh
// regardless of where the unpacked folder lives. Without this the ID is derived
// from the folder path, and moving the folder breaks the OAuth client binding.
//
// Safe to commit -- it is a public key. key.pem (the private half) is gitignored.
const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq8EFHbfY2MR3JcwPZ/V+TmvqXMjG2I6qUiEyM9xrSmtPdNMalN0rE/empRaM9fRugOmy7Q6J3712bL8C/EZDVFqD7uR3VUNwHN989Va6lcrmEpeqGqXsuZsuDJw8FbG4rqgC0W4F2kpiTUhQTFt4hATQehbAhAdZ2KBMO7JVp9nm87IYIgyU6pDVt9BCJpsRt0Sq5PS62gCX5R6YWCJrqMXy+FduDhuPn4kxqihysZ5dGRvc/iLKSmw4lIAfPYFSS5zXH3T+vbHdNB2daE6Oy7w6VoMsLF2IvkHYwQFUSIEW19nhNLPZ1MFCKmropyfD2kyrCd3DlP+FTo1xPx+6ewIDAQAB';

// Google Drive sync activates only when a client ID is configured, so a
// local-only build never asks for permissions it cannot use.
const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID ?? '';

// The extension does nothing anywhere else. Narrow by design: the whole point
// is that it augments the real excalidraw.com rather than replacing it.
const EXCALIDRAW_MATCHES = ['https://excalidraw.com/*'];

export default defineManifest({
  manifest_version: 3,
  name: 'Excalidraw Cloud',
  version: pkg.version,
  description: pkg.description,

  key: KEY,

  action: {
    default_title: 'Toggle the Excalidraw Cloud sidebar',
  },

  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  options_page: 'src/options/index.html',

  content_scripts: [
    {
      matches: EXCALIDRAW_MATCHES,
      js: ['src/content/main.tsx'],
      // document_idle so excalidraw.com has already written its scene to
      // localStorage before the panel reads it.
      run_at: 'document_idle',
    },
  ],

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

  icons: {
    '16': 'icons/icon-16.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
});
