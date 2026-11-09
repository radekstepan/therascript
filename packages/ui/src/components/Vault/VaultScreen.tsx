// packages/ui/src/components/Vault/VaultScreen.tsx
import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Text,
  TextField,
  Callout,
  Spinner,
} from '@radix-ui/themes';
import { ExclamationTriangleIcon, LockClosedIcon } from '@radix-ui/react-icons';
import type { VaultStatus } from '../../api/vault';
import { setupVault, unlockVault, vaultErrorMessage } from '../../api/vault';

interface VaultScreenProps {
  vault: VaultStatus;
  /** Reloads vault status (and lets the App gate re-render). */
  onAuthed: () => void;
}

export const VaultScreen: React.FC<VaultScreenProps> = ({
  vault,
  onAuthed,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSetup = !vault.hasVault;
  const isTransitioning =
    vault.status === 'unlocking' || vault.status === 'locking';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (isSetup && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      if (isSetup) {
        await setupVault(password);
      } else {
        await unlockVault(password);
      }
      onAuthed();
    } catch (submitError) {
      setError(vaultErrorMessage(submitError));
    } finally {
      // Never retain the password: clear the fields on success and failure.
      setPassword('');
      setConfirmPassword('');
      setBusy(false);
    }
  };

  return (
    <Flex
      align="center"
      justify="center"
      direction="column"
      gap="4"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--color-overlay)',
        backdropFilter: 'blur(5px)',
        zIndex: 1000,
      }}
    >
      <Card size="4" style={{ boxShadow: 'var(--shadow-5)', minWidth: 360 }}>
        <Flex direction="column" gap="4" asChild>
          <form onSubmit={submit}>
            <Flex align="center" gap="3">
              <LockClosedIcon width={24} height={24} />
              <Heading size="5">
                {isSetup ? 'Set vault password' : 'Unlock vault'}
              </Heading>
            </Flex>
            <Text size="2" color="gray">
              {isSetup
                ? 'Protects session transcripts, recordings, and chat history behind this password.' +
                  ' You will enter it each time the app starts to decrypt the vault.' +
                  ' Existing plaintext data on this machine is migrated into the vault on setup.'
                : 'Enter your vault password to open Therascript. The password is' +
                  ' also the encryption key, so it is required again after the app restarts.'}
            </Text>
            {isTransitioning ? (
              <Flex align="center" gap="3">
                <Spinner size="3" />
                <Text>
                  {vault.status === 'locking' ? 'Locking…' : 'Unlocking…'}
                </Text>
              </Flex>
            ) : (
              <>
                <Box>
                  <Text
                    as="label"
                    size="2"
                    weight="medium"
                    htmlFor="vault-password"
                  >
                    {isSetup ? 'New password' : 'Password'}
                  </Text>
                  <TextField.Root
                    id="vault-password"
                    type="password"
                    autoComplete={isSetup ? 'new-password' : 'current-password'}
                    autoFocus
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                    mt="1"
                  />
                </Box>
                {isSetup && (
                  <Box>
                    <Text
                      as="label"
                      size="2"
                      weight="medium"
                      htmlFor="vault-password-confirm"
                    >
                      Confirm password
                    </Text>
                    <TextField.Root
                      id="vault-password-confirm"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      disabled={busy}
                      mt="1"
                    />
                  </Box>
                )}
                {error && (
                  <Callout.Root color="red" size="1">
                    <Callout.Icon>
                      <ExclamationTriangleIcon />
                    </Callout.Icon>
                    <Callout.Text>{error}</Callout.Text>
                  </Callout.Root>
                )}
                <Button type="submit" size="3" loading={busy}>
                  {isSetup ? 'Create vault' : 'Unlock'}
                </Button>
                {!isSetup && (
                  <Text size="1" color="gray">
                    Wrong passwords are rate-limited. A second browser needs its
                    own unlock even while this one is open.
                  </Text>
                )}
              </>
            )}
          </form>
        </Flex>
      </Card>
    </Flex>
  );
};
