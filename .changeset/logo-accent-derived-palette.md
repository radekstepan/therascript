---
'@therascript/ui': patch
---

Derive the Therascript logo palette from the selected Radix accent and match the favicons to it. The waveform, wordmark, terminal dot, and focus ring now use coordinated accent steps (11/12 plus a tinted dot) instead of the fixed green palette, so every logo instance follows accent and light/dark/system appearance changes; the steps stay readable for pale accents (minimum 4.4:1 mark, 10.8:1 wordmark, 3:1 dot). The logo's hover color change is removed while keyboard focus keeps its visible outline. Favicon SVGs use the accent step-9 tile with the Radix contrast-token glyph (dark ink for yellow, amber, lime, mint, and sky), and the static PNG/ICO fallbacks plus `scripts/generate-favicons.mjs` now carry the same waveform artwork so browsers can't retain the old icon through another link.
