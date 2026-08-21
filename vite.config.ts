import { defineConfig, loadEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  // manifest.config.ts reads process.env to decide whether to declare the OAuth
  // permissions, so the env has to be loaded before it is imported.
  const env = loadEnv(mode, process.cwd(), '');
  process.env.VITE_GOOGLE_CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID ?? '';
  const { default: manifest } = await import('./manifest.config');

  return {
    plugins: [react(), crx({ manifest })],

    define: {
      // Excalidraw reads this to pick its React vs Preact build. Without the
      // define, the bundle throws "process is not defined" at import time.
      'process.env.IS_PREACT': JSON.stringify('false'),
    },

    build: {
      target: 'esnext',
      // esbuild minification never emits eval(); MV3's CSP rejects it.
      minify: 'esbuild',
      rollupOptions: {
        input: {
          // The editor is opened via chrome.tabs.create rather than being
          // referenced from the manifest, so it needs an explicit entry.
          editor: 'src/editor/index.html',
        },
      },
    },

    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
