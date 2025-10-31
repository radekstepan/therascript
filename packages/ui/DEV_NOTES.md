# @therascript/ui — Developer Notes

Purpose: React 19 UI for managing sessions, transcription, analysis, search, and system monitoring.

## Key entrypoints
- App: `src/App.tsx`
- Mount: `src/index.tsx`
- API clients: `src/api/*`
- Feature components: `src/components/*`

## Build/Run
- Dev: `yarn dev` (webpack-dev-server)
- Build: `yarn build` (webpack production)

## Notes
- Uses Radix UI Themes, Tailwind CSS, React Query, Jotai, React Router
- Targets API at `CORS_ORIGIN`-aligned host; see API `CORS_ORIGIN` env

## Gotchas
- When running `yarn dev` via root wrapper, UI is auto-started; port generally 3002 unless overridden