import { defineConfig } from 'vite';

// `base: './'` makes the built site relocatable: it works from a domain root, a
// sub-path (GitHub Pages project sites), or opened straight from the file system.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], 'lil-gui': ['lil-gui'] },
      },
    },
  },
  server: { port: 5173, open: false },
  preview: { port: 4173 },
});
