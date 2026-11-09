// @vitest-environment jsdom
// packages/ui/src/components/Vault/VaultScreen.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Theme } from '@radix-ui/themes';
import { VaultScreen } from './VaultScreen';
import type { VaultStatus } from '../../api/vault';

vi.mock('../../api/vault', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/vault')>();
  return {
    ...original,
    setupVault: vi.fn(),
    unlockVault: vi.fn(),
  };
});

import { setupVault, unlockVault } from '../../api/vault';

const lockedVault: VaultStatus = {
  status: 'locked',
  hasVault: true,
  authenticated: false,
  legacyFallback: false,
};

const freshVault: VaultStatus = {
  status: 'locked',
  hasVault: false,
  authenticated: false,
  legacyFallback: false,
};

function renderScreen(vault: VaultStatus, onAuthed = vi.fn()) {
  return render(
    <Theme>
      <VaultScreen vault={vault} onAuthed={onAuthed} />
    </Theme>
  );
}

beforeEach(() => {
  vi.mocked(setupVault).mockReset();
  vi.mocked(unlockVault).mockReset();
});

describe('VaultScreen', () => {
  it('renders the unlock form for an existing vault', () => {
    renderScreen(lockedVault);
    expect(screen.getByText('Unlock vault')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.queryByLabelText('Confirm password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDefined();
  });

  it('renders the setup form with confirmation for a fresh install', () => {
    renderScreen(freshVault);
    expect(screen.getByText('Set vault password')).toBeDefined();
    expect(screen.getByLabelText('New password')).toBeDefined();
    expect(screen.getByLabelText('Confirm password')).toBeDefined();
  });

  it('shows transitional states instead of the form', () => {
    renderScreen({ ...lockedVault, status: 'unlocking' });
    expect(screen.getByText('Unlocking…')).toBeDefined();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('unlocks and clears the password on success', async () => {
    const onAuthed = vi.fn();
    vi.mocked(unlockVault).mockResolvedValue({ ok: true, status: 'unlocked' });
    renderScreen(lockedVault, onAuthed);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() =>
      expect(unlockVault).toHaveBeenCalledWith('password123')
    );
    expect(onAuthed).toHaveBeenCalled();
    // The password field is cleared even on success.
    expect(input.value).toBe('');
  });

  it('clears the password and shows the error on failure', async () => {
    vi.mocked(unlockVault).mockRejectedValue(new Error('Incorrect password'));
    renderScreen(lockedVault);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'wrongpassword' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(unlockVault).toHaveBeenCalled());
    expect(await screen.findByText('Incorrect password')).toBeDefined();
    expect(input.value).toBe('');
  });

  it('refuses mismatched setup passwords client-side', async () => {
    renderScreen(freshVault);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }));
    expect(await screen.findByText('Passwords do not match.')).toBeDefined();
    expect(setupVault).not.toHaveBeenCalled();
  });

  it('refuses short passwords client-side', async () => {
    renderScreen(lockedVault);
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(
      await screen.findByText('Password must be at least 8 characters.')
    ).toBeDefined();
    expect(unlockVault).not.toHaveBeenCalled();
  });
});
