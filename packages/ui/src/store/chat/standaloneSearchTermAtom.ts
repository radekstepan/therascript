// packages/ui/src/store/chat/standaloneSearchTermAtom.ts
import { atom } from 'jotai';

/**
 * Atom holding the current search term entered for filtering standalone chats.
 */
export const standaloneSearchTermAtom = atom<string>('');
