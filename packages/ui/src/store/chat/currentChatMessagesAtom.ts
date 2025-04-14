import { atom } from 'jotai';
import { activeChatAtom } from '..';
import type { ChatMessage } from '../../types';

export const currentChatMessagesAtom = atom<ChatMessage[]>((get) => {
  const chat = get(activeChatAtom);
  // Ensure messages is always an array, even if chat or chat.messages is null/undefined
  // TODO should be inferred
  return Array.isArray(chat?.messages) ? chat.messages : [];
});
