import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      '@pd/ui': path.resolve(__dirname, '../shared/ui'),
    },
    // shared/ui has no node_modules of its own; its bare `react`/`react-dom`
    // imports (and any subpath — jsx-runtime, compiler-runtime, server, ...)
    // must resolve against desktop's own copy rather than a build-time
    // resolver failing to walk up past desktop/. `dedupe` handles this for
    // every subpath via the package's normal `exports` conditions, unlike
    // pinning a fixed list of exact resolved files. See web/vite.config.ts
    // for the full rationale (works today only by the classic resolver's
    // root fallback; a rolldown-resolver upgrade would break it silently).
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome105', 'safari15'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: 'dist',
  },
});
