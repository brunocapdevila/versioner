import { defineConfig } from 'vite-plus';
export default defineConfig({
  fmt: {
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
    sortPackageJson: false,
    ignorePatterns: [
      'node_modules',
      'dist',
      'coverage',
      'package-lock.json',
      'packages/versions/test/fixtures',
    ],
  },
  lint: { options: { typeAware: true, typeCheck: true } },
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
