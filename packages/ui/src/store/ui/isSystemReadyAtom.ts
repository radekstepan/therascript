// packages/ui/src/store/ui/isSystemReadyAtom.ts
import { atom } from 'jotai';

/**
 * Atom representing whether the backend services are fully initialized and ready.
 * - `true`: System is ready.
 * - `false`: System is initializing or in a degraded state.
 * Initial value is `false`. The UI will poll the readiness endpoint to set this to true.
 */
export const isSystemReadyAtom = atom(false);
