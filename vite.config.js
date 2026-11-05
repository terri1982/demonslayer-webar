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
        entryFileNames: 'vendor/app-[hash].js',
        chunkFileNames: chunkInfo =>
          chunkInfo.name === 'three' ? 'vendor/three-r165.js' : 'vendor/[name]-[hash].js',
        assetFileNames: assetInfo => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'vendor/style-[hash].css';
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
