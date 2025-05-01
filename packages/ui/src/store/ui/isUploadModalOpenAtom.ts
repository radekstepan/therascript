// Purpose: Defines a simple Jotai atom to manage the visibility state
//          (open or closed) of the session upload modal.
import { atom } from 'jotai'; // Import base atom function

/**
 * Atom representing the open/closed state of the session upload modal.
 * - `true`: Modal is open.
 * - `false`: Modal is closed.
 * Initial value is `false`.
 */
export const isUploadModalOpenAtom = atom(false);
