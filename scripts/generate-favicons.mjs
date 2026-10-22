// Generates one favicon SVG per Radix accent color (light + dark tile
// shades) plus static PNG/ICO fallbacks from the default-accent mark.
//
// Artwork: the AudioLines waveform (same 6-bar geometry as the on-page
// TherascriptLogo mark) centered on a rounded tile. Palette derivation
// mirrors Radix's own solid-button treatment, parsed from
// @radix-ui/themes so the icons always match the running theme:
//   tile  = the accent step-9 solid (light hex / dark display-p3)
//   glyph = the accent --contrast token (white, or dark ink for the
//           pale accents: amber, lime, mint, sky, yellow)
// Re-run after upgrading Radix or lucide-react:
//   node scripts/generate-favicons.mjs
//
// PNG/ICO fallbacks (favicon-16x16.png, favicon-32x32.png,
// apple-touch-icon.png, favicon.ico) are rasterized from the default
// accent's light tile/glyph colors with a tiny built-in renderer (no
// external tools): the artwork is axis-aligned round-capped bars, so a
// supersampled software rasterizer is exact and deterministic.
// Browsers fetch /favicon.ico and the PNG icon links even when the
// runtime SVG favicon switches per accent, so the fallbacks must carry
// the same waveform artwork.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(
  root,
  '..',
  'node_modules',
  '@radix-ui',
  'themes',
  'styles.css'
);
const uiPublicDir = path.join(root, '..', 'packages', 'ui', 'public');
const outDir = path.join(uiPublicDir, 'favicons');

// Default accent for the static fallbacks. Keep in sync with the
// 'ui-accent-color' default in accentColorAtom.ts, DEFAULT_FAVICON_ACCENT
// in favicon.ts, and the index.html first-paint fallback.
const DEFAULT_ACCENT = 'indigo';

// Keep in sync with RADIX_ACCENT_COLORS in
// packages/ui/src/store/ui/accentColorAtom.ts
const ACCENTS = [
  'gray', 'gold', 'bronze', 'brown', 'yellow', 'amber', 'orange',
  'tomato', 'red', 'ruby', 'crimson', 'pink', 'plum', 'purple',
  'violet', 'iris', 'indigo', 'blue', 'cyan', 'teal', 'jade',
  'green', 'grass', 'lime', 'mint', 'sky',
];

const css = fs.readFileSync(cssPath, 'utf8');
const lightBlockEnd = css.indexOf('.dark, .dark-theme');
const lightCss = css.slice(0, lightBlockEnd);
const darkCss = css.slice(lightBlockEnd);

function light9(accent) {
  const m = lightCss.match(new RegExp(`--${accent}-9:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`missing light ${accent}-9`);
  return m[1].toLowerCase();
}

// display-p3 uses the sRGB transfer function, so linearize with the sRGB
// EOTF, convert P3 -> sRGB via XYZ, then compand and clip.
function p3ToHex(r, g, b) {
  const lin = (c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const [R, G, B] = [r, g, b].map(lin);
  // P3-D65 -> XYZ-D65 -> sRGB-D65 (combined matrix)
  let sR = 2.521649 * R - 1.134962 * G - 0.386087 * B;
  let sG = -0.275073 * R + 1.549866 * G - 0.274792 * B;
  let sB = -0.015072 * R - 0.241349 * G + 1.256463 * B;
  const comp = (c) => {
    c = Math.min(1, Math.max(0, c));
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${comp(sR)}${comp(sG)}${comp(sB)}`;
}

function dark9(accent) {
  const m = darkCss.match(
    new RegExp(
      `--${accent}-9:\\s*color\\(display-p3\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`
    )
  );
  if (!m) throw new Error(`missing dark ${accent}-9`);
  return p3ToHex(Number(m[1]), Number(m[2]), Number(m[3]));
}

// Glyph ink for the step-9 tile. Radix defines --{accent}-contrast once
// in :root (shared by both appearances): white for saturated accents,
// dark ink for pale ones. Same treatment as Radix solid-button labels.
function contrastInk(accent) {
  const m = css.match(new RegExp(`--${accent}-contrast:\\s*([^;]+);`));
  if (!m) throw new Error(`missing ${accent}-contrast`);
  const value = m[1].trim().toLowerCase();
  if (value === 'white') return '#FFFFFF';
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  throw new Error(`unexpected ${accent}-contrast value: ${m[1].trim()}`);
}

// AudioLines glyph (Lucide path data, 24-unit grid) baked onto a 512
// grid with 96px padding. Keep in sync with the installed lucide-react
// AudioLines icon geometry (M2 10v3, M6 6v11, M10 3v18, M14 8v7,
// M18 5v13, M22 10v3).
const GLYPH = [
  'M122.67 229.33v40',
  'M176 176v146.67',
  'M229.33 136v240',
  'M282.67 202.67v93.33',
  'M336 162.67v173.33',
  'M389.33 229.33v40',
]
  .map((d) => `    <path d="${d}"/>`)
  .join('\n');

const svg = (tile, glyph) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n` +
  `  <rect width="512" height="512" rx="112" fill="${tile}"/>\n` +
  `  <g stroke="${glyph}" stroke-width="26.67" stroke-linecap="round" fill="none">\n${GLYPH}\n  </g>\n</svg>\n`;

fs.mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const accent of ACCENTS) {
  const light = light9(accent);
  const dark = dark9(accent);
  const glyph = contrastInk(accent);
  fs.writeFileSync(path.join(outDir, `${accent}.svg`), svg(light, glyph));
  manifest.push({ accent, theme: 'light', tile: light, glyph });
  // Always emit the -dark file (even when identical) so the runtime URL
  // mapping stays a pure function of accent + appearance.
  fs.writeFileSync(path.join(outDir, `${accent}-dark.svg`), svg(dark, glyph));
  manifest.push({ accent, theme: 'dark', tile: dark, glyph });
}
console.log(`wrote ${manifest.length} favicons to ${outDir}`);
console.log(JSON.stringify(manifest.map((m) => `${m.accent}${m.theme === 'dark' ? '-dark' : ''}:${m.tile}/${m.glyph}`)));

// Static fallbacks: software-render the default accent's light artwork
// (rounded tile + round-capped waveform bars) at 4x supersampling,
// then downsample for antialiased edges. Geometry mirrors the SVG
// template above, expressed on the same 512 grid.
const GRID = 512;
const TILE_RX = 112;
const STROKE_W = 26.67;
// [x, y0, y1] bar segments on the 512 grid (stroke centerlines).
const BARS = [
  [122.67, 229.33, 269.33],
  [176, 176, 322.67],
  [229.33, 136, 376],
  [282.67, 202.67, 296],
  [336, 162.67, 336],
  [389.33, 229.33, 269.33],
];

function hexRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function inRoundRect(x, y, size, r) {
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Distance from (x, y) to the vertical segment; round caps are implied
// by comparing against half the stroke width.
function inBar(x, y, bx, y0, y1, halfW) {
  const cy = Math.min(Math.max(y, y0), y1);
  return (x - bx) ** 2 + (y - cy) ** 2 <= halfW * halfW;
}

function renderArtwork(size, tileHex, glyphHex) {
  const SS = 4; // supersample factor per axis
  const gridPerPx = GRID / size;
  const tile = hexRgb(tileHex);
  const glyph = hexRgb(glyphHex);
  const halfW = STROKE_W / 2;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let tileCov = 0;
      let glyphCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Subpixel centers, mapped back onto the 512 grid.
          const x = (pxi + (sx + 0.5) / SS) * gridPerPx;
          const y = (py + (sy + 0.5) / SS) * gridPerPx;
          if (!inRoundRect(x, y, GRID, TILE_RX)) continue;
          tileCov++;
          if (BARS.some(([bx, y0, y1]) => inBar(x, y, bx, y0, y1, halfW))) {
            glyphCov++;
          }
        }
      }
      const n = SS * SS;
      const o = (py * size + pxi) * 4;
      if (tileCov === 0) continue; // transparent corner
      const g = glyphCov / n;
      const t = tileCov / n;
      // Straight (non-premultiplied) alpha: normalize color by coverage.
      px[o] = Math.round((glyph[0] * g + tile[0] * (t - g)) / t);
      px[o + 1] = Math.round((glyph[1] * g + tile[1] * (t - g)) / t);
      px[o + 2] = Math.round((glyph[2] * g + tile[2] * (t - g)) / t);
      px[o + 3] = Math.round(255 * t);
    }
  }
  return px;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Minimal RGBA PNG encoder with per-row adaptive filtering.
function encodePng(size, px) {
  const stride = size * 4;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < size; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const candidates = [];
    for (let filter = 0; filter < 5; filter++) {
      const out = Buffer.alloc(stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0;
        const b = prev[i];
        const c = i >= 4 ? prev[i - 4] : 0;
        const pred =
          filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
        out[i] = (row[i] - pred) & 0xff;
      }
      candidates.push(out);
    }
    // Pick the filter with the smallest sum of absolute byte values.
    let best = candidates[0];
    let bestScore = Infinity;
    for (const cand of candidates) {
      let score = 0;
      for (let i = 0; i < cand.length; i++) {
        score += cand[i] < 128 ? cand[i] : 256 - cand[i];
      }
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    rows.push(Buffer.concat([Buffer.from([candidates.indexOf(best)]), best]));
    prev = row;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function rasterizeFallbacks() {
  const tile = light9(DEFAULT_ACCENT);
  const glyph = contrastInk(DEFAULT_ACCENT);
  const render = (size, dest) => {
    fs.writeFileSync(dest, encodePng(size, renderArtwork(size, tile, glyph)));
  };
  render(16, path.join(uiPublicDir, 'favicon-16x16.png'));
  render(32, path.join(uiPublicDir, 'favicon-32x32.png'));
  render(180, path.join(uiPublicDir, 'apple-touch-icon.png'));
  // Multi-size ICO with PNG-compressed entries (Vista+).
  const entries = [16, 32, 48].map((size) =>
    encodePng(size, renderArtwork(size, tile, glyph))
  );
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((png, i) => {
    const size = [16, 32, 48][i];
    const o = 6 + i * 16;
    header[o] = size;
    header[o + 1] = size;
    header[o + 4] = 1; // color planes
    header[o + 6] = 32; // bits per pixel
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  fs.writeFileSync(
    path.join(uiPublicDir, 'favicon.ico'),
    Buffer.concat([header, ...entries])
  );
  console.log('wrote PNG/ICO fallbacks to', uiPublicDir);
}

rasterizeFallbacks();
