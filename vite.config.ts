import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Production builds are served from GitHub Pages at /pandaemoniumGame/; the dev server stays at /.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/pandaemoniumGame/' : '/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
}));
