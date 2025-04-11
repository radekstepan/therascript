// src/store/chatAtoms.ts
import { atom } from 'jotai';

// --- Base Atoms ---
export const activeChatIdAtom = atom<number | null>(null);
export const currentQueryAtom = atom('');
export const isChattingAtom = atom(false); // True if waiting for an AI response
export const chatErrorAtom = atom(''); // Errors specific to chat operations
