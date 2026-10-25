import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    target: 'es2022',
    platform: 'neutral',
    sourcemap: true,
    tsconfig: 'tsconfig.build.json',
  },
});
