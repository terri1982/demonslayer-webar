import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'public',
  resolve: {
    dedupe: ['three', '@pixiv/three-vrm-materials-mtoon'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        entryFileNames: 'vendor/app.js',
        chunkFileNames: chunkInfo =>
          chunkInfo.name === 'three' ? 'vendor/three-r165.js' : 'vendor/[name].js',
        assetFileNames: assetInfo => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'vendor/style.css';
          }
          return 'assets/[name][extname]';
        },
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('three-vrm-materials-mtoon')) {
            return 'three';
          }
          return undefined;
        },
      },
    },
  },
});
