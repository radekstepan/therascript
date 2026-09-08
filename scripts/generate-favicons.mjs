// Generates one favicon SVG per Radix accent color (light + dark tile shades).
// Tile color = the accent step-9 solid, parsed from @radix-ui/themes so the
// icons always match the running theme. Re-run after upgrading Radix:
//   node scripts/generate-favicons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(
  root,
  '..',
  'node_modules',
  '@radix-ui',
  'themes',
  'styles.css'
);
const outDir = path.join(root, '..', 'packages', 'ui', 'public', 'favicons');

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

// AudioLines glyph (Lucide path data) baked onto a 512 grid with 96px padding.
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

const svg = (tile) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n` +
  `  <rect width="512" height="512" rx="112" fill="${tile}"/>\n` +
  `  <g stroke="#FFFFFF" stroke-width="26.67" stroke-linecap="round" fill="none">\n${GLYPH}\n  </g>\n</svg>\n`;

fs.mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const accent of ACCENTS) {
  const light = light9(accent);
  const dark = dark9(accent);
  fs.writeFileSync(path.join(outDir, `${accent}.svg`), svg(light));
  manifest.push({ accent, theme: 'light', tile: light });
  // Always emit the -dark file (even when identical) so the runtime URL
  // mapping stays a pure function of accent + appearance.
  fs.writeFileSync(path.join(outDir, `${accent}-dark.svg`), svg(dark));
  manifest.push({ accent, theme: 'dark', tile: dark });
}
console.log(`wrote ${manifest.length} favicons to ${outDir}`);
console.log(JSON.stringify(manifest.map((m) => `${m.accent}${m.theme === 'dark' ? '-dark' : ''}:${m.tile}`)));
