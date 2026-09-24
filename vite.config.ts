import { defineConfig } from 'vite';
import path from 'node:path';

// /play is the Paste Wars server (npm run arena), proxied so the page can
// open its socket on its own origin in development exactly as it does in
// production, where the host nginx does the same job.
const play = { '/play': { target: 'http://localhost:8481', ws: true } };

// The sizing game runs ProcessPro's engine, from GitHub Packages. Point
// PROC_SRC at a ProcessPro checkout to work on the engine and the game
// together, and the package is swapped for the engine's source.
const procSrc = process.env.PROC_SRC;
const procEngine = procSrc ? path.resolve(procSrc, 'packages/engine') : undefined;

export default defineConfig({
  base: './',
  resolve: { alias: procEngine ? { '@jacob12244/proc-engine': path.join(procEngine, 'src/index.ts') } : {} },
  server: { port: 5180, open: true, proxy: play, fs: procEngine ? { allow: ['.', procEngine] } : undefined },
  preview: { proxy: play },
  worker: { format: 'es' },
  build: { target: 'es2020', chunkSizeWarningLimit: 1600 },
});
