// packages/ui/playwright.config.ts
//
// Playwright config for the Therascript UI. The dev server is started with
// E2E_TESTING=true so webpack inlines the flag (via DefinePlugin) and
// src/index.tsx registers the MSW Service Worker before mounting React.
//
// Runs on port 3003 (not the normal 3002) so we never collide with a
// developer's long-running `yarn dev:ui` session on 3002 — they keep their
// backend wiring intact while E2E tests boot an isolated webpack-dev-server
// with the MSW flag enabled.
//
// No API, SQLite, Redis, Elasticsearch, LM Studio, or Whisper is required —
// MSW intercepts all `/api/*` requests at the browser layer. See
// packages/ui/src/mocks/handlers.ts.
import { defineConfig, devices } from '@playwright/test';

const PORT = 3003;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `E2E_TESTING=true yarn dev --port ${PORT} --no-open`,
    // Healthcheck the static index.html rather than the SPA root — once
    // webpack-dev-server has finished its first compile this asset always
    // returns 200, whereas `/` depends on historyApiFallback resolving
    // before the bundle has booted. The extension's hidden stdout pipe
    // would otherwise mask a half-started server and the spec would
    // navigate into a 404.
    url: 'http://localhost:3003/index.html',
    // Locally we want the Playwright VSCode extension to reuse a dev
    // server the developer started in a terminal (via `yarn e2e:server`),
    // so the extension's auto-spawn race doesn't drop the spec. CI
    // always wants a fresh server with a clean MSW state.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
