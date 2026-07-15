import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: '.',
  // Nature Kit OBJ/MTL and character GLBs are imported as asset URLs (see model-assets.d.ts).
  assetsInclude: ['**/*.obj', '**/*.mtl', '**/*.glb'],
  server: {
    port: 5173,
    proxy: {
      '/join': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/arena': { target: 'http://127.0.0.1:8787', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@crowntag/content': path.resolve(__dirname, '../../packages/content/src/index.ts'),
      '@crowntag/protocol': path.resolve(__dirname, '../../packages/protocol/src/index.ts'),
      '@crowntag/sim': path.resolve(__dirname, '../../packages/sim/src/index.ts'),
    },
  },
});
