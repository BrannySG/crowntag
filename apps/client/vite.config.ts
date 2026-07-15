import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: '.',
  server: { port: 5173 },
  resolve: {
    alias: {
      '@crowntag/content': path.resolve(__dirname, '../../packages/content/src/index.ts'),
      '@crowntag/protocol': path.resolve(__dirname, '../../packages/protocol/src/index.ts'),
      '@crowntag/sim': path.resolve(__dirname, '../../packages/sim/src/index.ts'),
    },
  },
});
