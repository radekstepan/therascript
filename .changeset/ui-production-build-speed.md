---
'@therascript/ui': patch
---

# Task 1: speed up the UI production build

- Production builds now emit an external `bundle.[hash].js.map` instead of an inline source map (the config comment always said to use `source-map` for production, but `devtool` was hardcoded to `inline-source-map`). Bundle shrinks from ~14 MB to ~3.3 MB and cold builds drop from ~91s to ~64s.
- Webpack filesystem cache is enabled, so repeat builds after a small change (turbo cache miss, webpack cache hit) finish in ~5s instead of ~90s.
- The UI tsconfig disables `composite`/`declaration`/`declarationMap`: no workspace package consumes `@therascript/ui` types, so ts-loader no longer wastes time writing `.d.ts` files into `dist`.
