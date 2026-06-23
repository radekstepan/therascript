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
    url: BASE_URL,
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
