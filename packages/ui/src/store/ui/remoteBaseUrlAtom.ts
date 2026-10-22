// Purpose: Persists the last known good remote LM Studio URL across
//          browser sessions so the chat, analysis, and verification
//          modals can pre-fill it.
import { atomWithStorage } from 'jotai/utils';

/**
 * Atom storing the last known good remote LM Studio-compatible base URL
 * (e.g. "http://192.168.1.100:1234"). Shared by every consumer that needs
 * to remember a remote endpoint, so a single value keeps the chat,
 * analysis, and verification modals in sync.
 *
 * Write contract (single owner):
 * - Written ONLY by the shared model-discovery path in
 *   `LlmEndpointModelPicker`, after a remote models request succeeds
 *   with a valid models response (an empty list still counts).
 * - Never written by typing, clearing, toggling to Local, modal Save /
 *   Submit handlers, or local-endpoint requests. HTTP errors and
 *   malformed responses must not overwrite the remembered value.
 *
 * Read contract:
 * - Every remote endpoint form pre-fills from this value when opened in
 *   remote mode without a backend-provided URL, or switched to remote
 *   mode with an untouched empty field. In-progress edits always win
 *   over the remembered value within a session.
 *
 * - Persisted in `localStorage` under the key `'llm-remote-base-url'`.
 * - Defaults to an empty string when no value is stored. Empty string means
 *   "no remembered URL" — the picker will not pre-fill the input.
 * - Never holds an API token — only the endpoint URL string.
 */
export const remoteBaseUrlAtom = atomWithStorage<string>(
  'llm-remote-base-url',
  ''
);
