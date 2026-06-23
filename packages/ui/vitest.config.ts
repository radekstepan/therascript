// packages/ui/vitest.config.ts
//
// Per-package override of the root vitest config. The root config
// (`/vitest.config.ts`) defaults to the `node` environment, which is right
// for the API/worker packages but wrong for React component tests. This
// file re-includes the same test glob, switches the environment to
// `jsdom` so `@testing-library/react` can mount components, and points
// at `vitest.setup.ts` for browser-global polyfills.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
});
