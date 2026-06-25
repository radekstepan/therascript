/**
 * In-process registry of LLM model instances that have been loaded during
 * this server's lifetime, keyed by base URL. Used to ensure that a clean
 * shutdown unloads every URL we've ever loaded against — not just the
 * currently "active" one — so that per-request remote URLs (e.g. one-off
 * analysis jobs) don't leave models resident in a remote LM Studio's VRAM.
 *
 * The tracker is intentionally process-local. On a server restart it is
 * empty; the boot-time model-state sync (`syncModelStateOnBoot`) handles
 * reconciling whatever LM Studio actually has loaded in that case.
 *
 * Best-effort by design: all methods are non-throwing. The tracker is a
 * safety net for shutdown, not a source of truth.
 */

const loadedByUrl = new Map<string, Set<string>>();

export const markLoaded = (
  baseUrl: string | undefined,
  instanceId: string | undefined
): void => {
  if (!baseUrl || !instanceId) return;
  const normalized = baseUrl.replace(/\/+$/, '');
  const set = loadedByUrl.get(normalized);
  if (set) {
    set.add(instanceId);
  } else {
    loadedByUrl.set(normalized, new Set([instanceId]));
  }
};

export const markUnloaded = (
  baseUrl: string | undefined,
  instanceId: string | undefined
): void => {
  if (!baseUrl || !instanceId) return;
  const normalized = baseUrl.replace(/\/+$/, '');
  const set = loadedByUrl.get(normalized);
  if (!set) return;
  set.delete(instanceId);
  if (set.size === 0) loadedByUrl.delete(normalized);
};

export const getLoadedBaseUrls = (): string[] => {
  return Array.from(loadedByUrl.keys());
};

export const getLoadedInstanceIds = (baseUrl: string): string[] => {
  const normalized = baseUrl.replace(/\/+$/, '');
  const set = loadedByUrl.get(normalized);
  return set ? Array.from(set) : [];
};

export const clear = (): void => {
  loadedByUrl.clear();
};

// Test-only — exported so unit tests can seed and inspect state.
export const __resetForTests = (): void => {
  loadedByUrl.clear();
};
