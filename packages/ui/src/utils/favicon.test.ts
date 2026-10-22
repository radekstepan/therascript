import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';
import { applyFavicon, faviconHref } from './favicon';
import { RADIX_ACCENT_COLORS } from '../store/ui/accentColorAtom';

// NOTE: plain string paths — under jsdom `new URL(...)` returns a jsdom
// URL object that node:fs cannot resolve back to a file.
const FAVICONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
  'favicons'
);

describe('faviconHref', () => {
  it('maps accent + appearance to the generated variant', () => {
    expect(faviconHref('indigo', 'light')).toBe('/favicons/indigo.svg');
    expect(faviconHref('teal', 'dark')).toBe('/favicons/teal-dark.svg');
  });

  it('falls back to indigo for unknown accents', () => {
    expect(faviconHref('not-a-color', 'light')).toBe('/favicons/indigo.svg');
    expect(faviconHref(undefined, 'dark')).toBe('/favicons/indigo-dark.svg');
  });

  it('resolves a generated SVG for every supported accent', () => {
    expect(RADIX_ACCENT_COLORS.length).toBeGreaterThan(0);
    for (const accent of RADIX_ACCENT_COLORS) {
      for (const appearance of ['light', 'dark'] as const) {
        const href = faviconHref(accent, appearance);
        // Supported accents map to their own file, never the fallback.
        expect(href).toBe(
          `/favicons/${accent}${appearance === 'dark' ? '-dark' : ''}.svg`
        );
        const file = join(FAVICONS_DIR, href.slice('/favicons/'.length));
        expect(existsSync(file)).toBe(true);
        // Waveform glyph on a rounded tile.
        const svg = readFileSync(file, 'utf8');
        expect(svg).toContain('<rect');
        expect(svg).toContain('<path d="M');
      }
    }
  });

  it('uses dark glyph ink on pale-accent tiles', () => {
    // Pale step-9 tiles need dark ink for a readable glyph; saturated
    // accents keep white. Values come from the Radix --contrast tokens.
    for (const accent of ['yellow', 'amber', 'lime', 'mint', 'sky']) {
      const svg = readFileSync(join(FAVICONS_DIR, `${accent}.svg`), 'utf8');
      expect(svg).not.toContain('stroke="#FFFFFF"');
    }
    const indigo = readFileSync(join(FAVICONS_DIR, 'indigo.svg'), 'utf8');
    expect(indigo).toContain('stroke="#FFFFFF"');
  });
});

describe('applyFavicon', () => {
  beforeEach(() => {
    document.head
      .querySelectorAll('link#favicon-svg')
      .forEach((el) => el.remove());
  });

  it('updates the existing favicon link', () => {
    const link = document.createElement('link');
    link.id = 'favicon-svg';
    link.rel = 'icon';
    link.setAttribute('href', '/favicons/indigo.svg');
    document.head.appendChild(link);

    applyFavicon('/favicons/teal-dark.svg');
    expect(
      document.querySelector('link#favicon-svg')?.getAttribute('href')
    ).toBe('/favicons/teal-dark.svg');
  });

  it('creates the link when missing', () => {
    applyFavicon('/favicons/ruby.svg');
    const link = document.querySelector('link#favicon-svg');
    expect(link?.getAttribute('href')).toBe('/favicons/ruby.svg');
  });
});
