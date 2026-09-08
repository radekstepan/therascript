import { describe, expect, it, beforeEach } from 'vitest';
import { applyFavicon, faviconHref } from './favicon';

describe('faviconHref', () => {
  it('maps accent + appearance to the generated variant', () => {
    expect(faviconHref('indigo', 'light')).toBe('/favicons/indigo.svg');
    expect(faviconHref('teal', 'dark')).toBe('/favicons/teal-dark.svg');
  });

  it('falls back to indigo for unknown accents', () => {
    expect(faviconHref('not-a-color', 'light')).toBe('/favicons/indigo.svg');
    expect(faviconHref(undefined, 'dark')).toBe('/favicons/indigo-dark.svg');
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
