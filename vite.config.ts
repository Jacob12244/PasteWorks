import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5180, open: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1600 },
});
