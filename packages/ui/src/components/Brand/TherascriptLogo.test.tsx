// @vitest-environment jsdom
// packages/ui/src/components/Brand/TherascriptLogo.test.tsx
//
// Contract test for the shared brand lockup: full variant renders the
// waveform + lowercase wordmark + signature dot as a home link; the
// mark-only variant keeps the link's accessible name for collapsed
// layouts and icon-only contexts.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TherascriptLogo, type TherascriptLogoProps } from './TherascriptLogo';

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
