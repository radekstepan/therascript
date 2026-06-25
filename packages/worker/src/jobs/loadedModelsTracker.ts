/**
 * Worker-side mirror of the API's `loadedModelsTracker`. Tracks every URL
 * the worker has called `POST /api/v1/models/load` against during this
 * worker's lifetime, so that a worker shutdown (SIGINT / SIGTERM) can
 * unload each one in turn.
 *
 * The analysis worker can load models against per-job remote URLs that the
 * API process has no visibility into, so the worker must perform its own
 * unload pass on shutdown.
 */

const loadedByUrl = new Map<string, Set<string>>();

const normalize = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

export const markLoaded = (
  baseUrl: string | undefined,
  instanceId: string | undefined
): void => {
  if (!baseUrl || !instanceId) return;
  const key = normalize(baseUrl);
  const set = loadedByUrl.get(key);
  if (set) {
    set.add(instanceId);
  } else {
    loadedByUrl.set(key, new Set([instanceId]));
  }
};

export const markUnloaded = (
  baseUrl: string | undefined,
  instanceId: string | undefined
): void => {
  if (!baseUrl || !instanceId) return;
  const key = normalize(baseUrl);
  const set = loadedByUrl.get(key);
  if (!set) return;
  set.delete(instanceId);
  if (set.size === 0) loadedByUrl.delete(key);
};

export const getLoadedBaseUrls = (): string[] => {
  return Array.from(loadedByUrl.keys());
};

export const clear = (): void => {
  loadedByUrl.clear();
};
