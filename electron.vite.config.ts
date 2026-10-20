import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { pruneAssets } from './tools/pruneAssets';
import { buildFeatures } from './tools/hotBuild';

const features = buildFeatures();

export default defineConfig({
  main: {
    define: {
      __BUILD_IDENTITY__: JSON.stringify(features.identity),
      __BUILTIN_FEATURES__: features.bundle,
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), moduleWorker: resolve('src/main/moduleWorker.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          overlay: resolve('src/preload/overlay.ts'), settings: resolve('src/preload/settings.ts'),
          chat: resolve('src/preload/chat.ts'), game: resolve('src/preload/game.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    publicDir: resolve('assets'),
    plugins: [react(), pruneAssets()],
    build: {
      rollupOptions: {
        input: {
          overlay: resolve('src/renderer/overlay/index.html'),
          settings: resolve('src/renderer/settings/index.html'),
          chat: resolve('src/renderer/chat/index.html'),
          game: resolve('src/renderer/game/index.html'),
        },
      },
    },
  },
});
