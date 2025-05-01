// Purpose: Defines a Jotai atom to manage the content of temporary notification messages (toasts).
import { atom } from 'jotai';

/**
 * Atom holding the message content for the next toast notification to be displayed.
 * - Setting this atom to a string value will trigger the toast display (handled in App.tsx).
 * - Setting it back to `null` or letting the toast timeout will hide the toast.
 * Initial value is `null`, meaning no toast is shown initially.
 */
export const toastMessageAtom = atom<string | null>(null);
