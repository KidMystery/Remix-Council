import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Dev-server host allowance: sandbox/preview hosts change per session
      // (e.g. "3000-<sandboxId>.e2b.app"), so they can't be enumerated here.
      // This applies to the DEV server only — the Express app still enforces
      // the real gates (COUNCIL_ACCESS_KEY, OWNER_EMAIL, rate limiting) on
      // every API route.
      allowedHosts: true,
    },
  };
});
