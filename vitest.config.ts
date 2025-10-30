import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.{test,spec}.ts',
      'packages/**/src/**/*.{test,spec}.tsx',
    ],
    environment: 'node',
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
