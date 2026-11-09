// packages/ui/src/api/vault.ts
import axios from 'axios';
import type { QueryClient } from '@tanstack/react-query';

export const VAULT_STATUS_QUERY_KEY = ['vaultStatus'] as const;

export type VaultLifecycleStatus =
  | 'locked'
  | 'unlocking'
  | 'unlocked'
  | 'locking';

export interface VaultStatus {
  status: VaultLifecycleStatus;
  hasVault: boolean;
  authenticated: boolean;
  legacyFallback: boolean;
}

export const fetchVaultStatus = async (): Promise<VaultStatus> => {
  const response = await axios.get<VaultStatus>('/api/vault/status');
  return response.data;
};

export const setupVault = async (
  password: string
): Promise<{ ok: boolean; status: string }> => {
  const response = await axios.post('/api/vault/setup', { password });
  return response.data;
};

export const unlockVault = async (
  password: string
): Promise<{ ok: boolean; status: string }> => {
  const response = await axios.post('/api/vault/unlock', { password });
  return response.data;
};

export const changeVaultPassword = async (
  oldPassword: string,
  newPassword: string
): Promise<{ ok: boolean; status: string }> => {
  const response = await axios.post('/api/vault/change-password', {
    oldPassword,
    newPassword,
  });
  return response.data;
};

/**
 * Refreshes the vault gate whenever any API call is rejected with 401.
 * 401s only come from the vault guard/session check, so any of them means
 * this browser lost its session (lock from another tab, server restart).
 */
export function installVaultUnauthorizedHandler(
  queryClient: QueryClient
): () => void {
  const id = axios.interceptors.response.use(
    (response) => response,
    (error) => {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        queryClient.invalidateQueries({
          queryKey: [...VAULT_STATUS_QUERY_KEY],
        });
      }
      return Promise.reject(error);
    }
  );
  return () => {
    axios.interceptors.response.eject(id);
  };
}

export function vaultErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string; error?: string }
      | undefined;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    if (error.response?.status === 429)
      return 'Too many attempts. Slow down and retry.';
    if (error.response?.status === 409)
      return 'A vault operation is already running. Retry shortly.';
  }
  return error instanceof Error ? error.message : 'Vault request failed';
}
