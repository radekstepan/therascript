// packages/ui/src/mocks/server.ts
//
// MSW node-server setup for Vitest + jsdom. Not yet consumed by any test,
// but created now so handlers.ts stays a single source. Wire this into
// packages/ui/vitest.setup.ts when component tests start needing
// network-level mocks.
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
