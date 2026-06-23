import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.{test,spec}.ts',
      'packages/**/src/**/*.{test,spec}.tsx',
    ],
    environment: 'node',
    // Per-package overrides. The UI package renders React components
    // that touch browser-only APIs (`ResizeObserver`, `matchMedia`,
    // etc.), so its specs need `jsdom`. Other packages (api, worker,
    // data) only exercise backend logic and stay on `node`.
    environmentMatchGlobs: [['packages/ui/**/*.{test,spec}.{ts,tsx}', 'jsdom']],
    setupFiles: [
      // Order matters: UI polyfills must load before any spec runs so
      // Radix's layout effects don't blow up inside `act(...)`.
      'packages/ui/vitest.setup.ts',
    ],
    globals: true,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
    },
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
});
