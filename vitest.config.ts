import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: {
      '@versioner-local/versions': new URL('./packages/versions/src/index.ts', import.meta.url)
        .pathname,
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
