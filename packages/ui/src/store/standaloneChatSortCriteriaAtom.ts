/*
 * packages/ui/src/store/standaloneChatSortCriteriaAtom.ts
 * State for sorting standalone chats.
 */
import { atomWithStorage } from 'jotai/utils';

// Define possible sort criteria for standalone chats
export type StandaloneChatSortCriteria = 'name' | 'date' | 'tags';

// Atom to store the current sort criteria, persisted in localStorage
export const standaloneChatSortCriteriaAtom = atomWithStorage<StandaloneChatSortCriteria>('standalone-chat-sort-criteria', 'date');

// TODO comments should not be removed
