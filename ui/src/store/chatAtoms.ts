// src/store/chatAtoms.ts
import { atom } from 'jotai';
import { activeChatAtom } from './sessionAtoms'; // Import dependent atom
import type { ChatMessage } from '../types';

// --- Chat State Atoms ---
export const currentQueryAtom = atom('');
export const isChattingAtom = atom(false); // Tracks if AI response is pending
export const chatErrorAtom = atom(''); // For non-toast errors like empty message, no selection

// --- Toast State Atom ---
// Holds the message for the next toast to show. Null means no toast.
export const toastMessageAtom = atom<string | null>(null);

// --- Derived Read Atoms ---
export const currentChatMessagesAtom = atom<ChatMessage[]>((get) => {
  const chat = get(activeChatAtom);
  // Ensure messages is always an array, even if chat or chat.messages is null/undefined
  return Array.isArray(chat?.messages) ? chat.messages : [];
});
