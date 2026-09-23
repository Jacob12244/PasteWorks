import { defineConfig } from 'vite';

// /play is the Paste Wars server (npm run arena), proxied so the page can
// open its socket on its own origin in development exactly as it does in
// production, where the host nginx does the same job.
const play = { '/play': { target: 'http://localhost:8481', ws: true } };

export default defineConfig({
  base: './',
  server: { port: 5180, open: true, proxy: play },
  preview: { proxy: play },
  build: { target: 'es2020', chunkSizeWarningLimit: 1600 },
});
