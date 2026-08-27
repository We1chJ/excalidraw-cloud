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

    build: {
      target: 'esnext',
      // esbuild minification never emits eval(); MV3's CSP rejects it.
      minify: 'esbuild',
    },

    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
