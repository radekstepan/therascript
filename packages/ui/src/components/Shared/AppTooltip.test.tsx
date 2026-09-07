// @vitest-environment jsdom
// packages/ui/src/components/Shared/AppTooltip.test.tsx
//
// Regression tests for AppTooltip (Radix tooltip wrapper):
//
//   - Shows the Radix tooltip content on hover.
//   - Renders children unwrapped when content is undefined.
//   - REGRESSION: AppTooltip wrapping a DropdownMenu.Trigger must not
//     break the menu — clicking the trigger still opens it. (A previous
//     layout nested the tooltip BETWEEN DropdownMenu.Trigger and its
//     button; the asChild trigger merged its handlers into AppTooltip,
//     which dropped them, and the menu stopped opening.)
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Theme, DropdownMenu, IconButton } from '@radix-ui/themes';

import { AppTooltip } from './AppTooltip';

function renderInTheme(ui: React.ReactElement) {
  return render(<Theme>{ui}</Theme>);
}

describe('AppTooltip', () => {
  it('shows Radix tooltip content on hover', async () => {
    const user = userEvent.setup();
    renderInTheme(
      <AppTooltip content="Hello tooltip">
        <button>Hover me</button>
      </AppTooltip>
    );
    await user.hover(screen.getByRole('button', { name: 'Hover me' }));
    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toContain(
        'Hello tooltip'
      );
    });
  });

  it('renders no native title attribute', () => {
    renderInTheme(
      <AppTooltip content="Hello tooltip">
        <button>Hover me</button>
      </AppTooltip>
    );
    expect(
      screen.getByRole('button', { name: 'Hover me' }).getAttribute('title')
    ).toBeNull();
  });

  it('renders children unwrapped when content is undefined', () => {
    const { container } = renderInTheme(
      <AppTooltip content={undefined}>
        <button>Plain</button>
      </AppTooltip>
    );
    expect(
      screen.getByRole('button', { name: 'Plain' }) instanceof HTMLElement
    ).toBe(true);
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('control: plain DropdownMenu trigger opens the menu on click', async () => {
    const user = userEvent.setup();
    renderInTheme(
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <IconButton aria-label="Plain options">···</IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item>Edit Details</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    );
    await user.click(screen.getByRole('button', { name: 'Plain options' }));
    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: 'Edit Details' }) instanceof
          HTMLElement
      ).toBe(true);
    });
  });

  it('REGRESSION: AppTooltip around a DropdownMenu.Trigger still opens the menu on click', async () => {
    const user = userEvent.setup();
    renderInTheme(
      <DropdownMenu.Root>
        <AppTooltip content="Chat item options">
          <DropdownMenu.Trigger>
            <IconButton aria-label="Chat item options">···</IconButton>
          </DropdownMenu.Trigger>
        </AppTooltip>
        <DropdownMenu.Content>
          <DropdownMenu.Item>Edit Details</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    );
    await user.click(screen.getByRole('button', { name: 'Chat item options' }));
    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: 'Edit Details' }) instanceof
          HTMLElement
      ).toBe(true);
    });
  });

  it('menu still opens when AppTooltip content is undefined (renders unwrapped)', async () => {
    const user = userEvent.setup();
    renderInTheme(
      <DropdownMenu.Root>
        <AppTooltip content={undefined}>
          <DropdownMenu.Trigger>
            <IconButton aria-label="Conditional options">···</IconButton>
          </DropdownMenu.Trigger>
        </AppTooltip>
        <DropdownMenu.Content>
          <DropdownMenu.Item>Edit Details</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    );
    await user.click(
      screen.getByRole('button', { name: 'Conditional options' })
    );
    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: 'Edit Details' }) instanceof
          HTMLElement
      ).toBe(true);
    });
  });
});
