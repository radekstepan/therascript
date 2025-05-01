// Purpose: Defines a Jotai atom to hold the current search term used for filtering
//          the list of standalone chats displayed in the UI.
// NOTE: This atom was previously used but the search functionality on the landing page
//       has been removed or changed. This might be unused now. Check component usage.
import { atom } from 'jotai';

/**
 * Atom holding the current search term entered by the user for filtering
 * the standalone chats list. Initial value is an empty string.
 */
export const standaloneSearchTermAtom = atom<string>('');
