// @vitest-environment jsdom
// packages/ui/src/components/Shared/AppBadge.test.tsx
//
// Regression test: AppBadge must never render as a full-radius pill.
// It omits the `radius` prop so labels inherit the theme default
// (subtly-rounded rectangle, like the Fact Check labels).
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Theme } from '@radix-ui/themes';
import { AppBadge } from './AppBadge';

describe('AppBadge', () => {
  it('renders as a subtly-rounded rectangle, not a full-radius oval', () => {
    render(
      <Theme>
        <AppBadge color="gray" variant="soft" size="1">
          label
        </AppBadge>
      </Theme>
    );

    const badge = screen.getByText('label');

    expect(badge).not.toBeNull();
    expect(badge.getAttribute('data-radius')).not.toBe('full');
  });
});
