import { defineConfig } from 'vite';

// `base: './'` makes the built site relocatable: it works from a domain root or any
// sub-path (GitHub Pages project sites, `location /maze/`) without a rebuild.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Vite 8 (rolldown) only accepts the function form of manualChunks.
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/lil-gui/')) return 'lil-gui';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173, open: false },
  preview: { port: 4173 },
});
