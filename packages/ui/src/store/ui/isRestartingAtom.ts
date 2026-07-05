// packages/ui/src/store/ui/isRestartingAtom.ts
import { atom } from 'jotai';

// True while a user-initiated restart is in progress. When set, App.tsx
// renders the dedicated <RestartScreen /> overlay instead of the generic
// <ReadinessOverlay />. App.tsx resets this to false once the readiness
// query reports the system is back online.
export const isRestartingAtom = atom(false);
