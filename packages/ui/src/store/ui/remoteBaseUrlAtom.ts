// Purpose: Persists the last user-entered remote LM Studio URL across browser
//          sessions so the chat and analysis modals can pre-fill it.
import { atomWithStorage } from 'jotai/utils';

/**
 * Atom storing the last remote LM Studio-compatible base URL the user typed
 * (e.g. "http://192.168.1.100:1234"). Shared by every consumer that needs
 * to remember a remote endpoint, so a single input keeps the chat and
 * analysis modals in sync.
 *
 * - Persisted in `localStorage` under the key `'llm-remote-base-url'`.
 * - Defaults to an empty string when no value is stored. Empty string means
 *   "no remembered URL" — the picker will not pre-fill the input.
 */
export const remoteBaseUrlAtom = atomWithStorage<string>(
  'llm-remote-base-url',
  ''
);
