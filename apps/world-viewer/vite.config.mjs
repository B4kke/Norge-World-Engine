import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        'device-evidence': resolve(import.meta.dirname, 'device-evidence.html'),
      },
    },
  },
});
