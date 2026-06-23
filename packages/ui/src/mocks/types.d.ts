// packages/ui/src/mocks/types.d.ts
//
// Type declarations for env vars inlined at build time by webpack
// DefinePlugin (see packages/ui/webpack.config.js). Without this, TS strict
// mode rejects `process.env.E2E_TESTING` even though webpack substitutes it
// during bundling.
declare namespace NodeJS {
  interface ProcessEnv {
    E2E_TESTING?: 'true' | 'false';
  }
}
