// @vitest-environment jsdom
// packages/ui/src/components/Brand/TherascriptLogo.test.tsx
//
// Contract test for the shared brand lockup: full variant renders the
// waveform + lowercase wordmark + signature dot as a home link; the
// mark-only variant keeps the link's accessible name for collapsed
// layouts and icon-only contexts.
import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TherascriptLogo, type TherascriptLogoProps } from './TherascriptLogo';

// NOTE: build a plain string path. Under jsdom `new URL(...)` returns a
// jsdom URL object that node:fs cannot resolve back to a file.
const logoCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'therascript-logo.css'),
  'utf8'
);

function renderLogo(props: TherascriptLogoProps = {}) {
  return render(
    <MemoryRouter>
      <TherascriptLogo {...props} />
    </MemoryRouter>
  );
}

describe('TherascriptLogo', () => {
  it('renders the full lockup linking home', () => {
    const { container } = renderLogo();

    const link = screen.getByRole('link', { name: 'Therascript home' });
    expect(link.getAttribute('href')).toBe('/');

    // Wordmark is real text (lowercase per brand spec), dot separately colored.
    const wordmark = container.querySelector('.brand-logo__wordmark');
    expect(wordmark?.textContent).toBe('therascript.');
    const dot = container.querySelector('.brand-logo__dot');
    expect(dot?.textContent).toBe('.');

    // Waveform mark is decorative; the link name carries meaning.
    const mark = container.querySelector('.brand-logo__mark');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.querySelector('svg')).not.toBeNull();
  });

  it('hides the wordmark in mark variant but keeps the link name', () => {
    const { container } = renderLogo({ variant: 'mark' });

    expect(
      screen.getByRole('link', { name: 'Therascript home' })
    ).not.toBeNull();
    expect(container.querySelector('.brand-logo__wordmark')).toBeNull();
    expect(container.querySelector('.brand-logo__mark svg')).not.toBeNull();
  });

  it('applies size and custom className', () => {
    const { container } = renderLogo({ size: 'sm', className: 'my-logo' });

    const link = screen.getByRole('link', { name: 'Therascript home' });
    expect(link.classList.contains('brand-logo--sm')).toBe(true);
    expect(link.classList.contains('my-logo')).toBe(true);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('20');
  });

  it('uses the plan-exact 23px mark at md size', () => {
    const { container } = renderLogo({ size: 'md' });

    expect(container.querySelector('svg')?.getAttribute('width')).toBe('23');
  });
});

describe('TherascriptLogo palette', () => {
  it('derives coordinated steps from the accent, not fixed greens', () => {
    // Mark/ink/focus use distinct high-contrast palette steps; the dot
    // is a tint mixed from the mark step.
    expect(logoCss).toContain('var(--accent-11');
    expect(logoCss).toContain('var(--accent-12');
    expect(logoCss).toContain('color-mix');
    expect(logoCss).toContain('--brand-logo-dot');

    // Old fixed-green brand palette must not come back.
    for (const hex of ['#428366', '#284a3d', '#62a985', '#63b69a']) {
      expect(logoCss.toLowerCase()).not.toContain(hex);
    }
  });

  it('has no hover styling', () => {
    expect(logoCss).not.toContain(':hover');
  });

  it('keeps a visible keyboard focus indication', () => {
    expect(logoCss).toContain('.brand-logo:focus-visible');
    expect(logoCss).toMatch(/\.brand-logo:focus-visible\s*\{[^}]*outline:/);
  });
});
