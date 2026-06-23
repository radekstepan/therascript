// packages/ui/src/mocks/browser.ts
//
// MSW Service Worker setup for the browser. Only loaded dynamically from
// src/index.tsx when process.env.E2E_TESTING === 'true', so production
// bundles never import this file.
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
