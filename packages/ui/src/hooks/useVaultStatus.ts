// packages/ui/src/hooks/useVaultStatus.ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  fetchVaultStatus,
  VAULT_STATUS_QUERY_KEY,
  type VaultStatus,
} from '../api/vault';

const UNKNOWN_VAULT: VaultStatus = {
  status: 'locked',
  hasVault: false,
  authenticated: false,
  legacyFallback: false,
};

/**
 * Vault gate state. Polls while locked or transitioning so
 * the screen follows server-side transitions; slows to a heartbeat once
 * unlocked (a lock from another tab surfaces within seconds).
 */
export function useVaultStatus() {
  const queryClient = useQueryClient();
  const query = useQuery<VaultStatus, Error>({
    queryKey: [...VAULT_STATUS_QUERY_KEY],
    queryFn: fetchVaultStatus,
    refetchInterval: (state) => {
      const data = state.state.data;
      if (!data) return 3000;
      if (!data.authenticated || data.status !== 'unlocked') return 3000;
      if (data.legacyFallback) return false;
      return 15000;
    },
    refetchOnWindowFocus: true,
    retry: false,
  });

  const refresh = useCallback(() => {
    return queryClient.invalidateQueries({
      queryKey: [...VAULT_STATUS_QUERY_KEY],
    });
  }, [queryClient]);

  const clearVaultCaches = useCallback(() => {
    // Drops every cached query (sessions, chats, search, verification…)
    // so a locked screen never renders stale protected data on the way
    // out, and a fresh unlock refetches from the open database.
    queryClient.clear();
  }, [queryClient]);

  return {
    vault: query.data ?? UNKNOWN_VAULT,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    // No successful status fetch yet (e.g. API still booting while the UI
    // is already up). Callers must not treat this as "no vault exists":
    // UNKNOWN_VAULT defaults hasVault to false, which would render the
    // setup form instead of the unlock form.
    isUnresolved: !query.data,
    refresh,
    clearVaultCaches,
  };
}
