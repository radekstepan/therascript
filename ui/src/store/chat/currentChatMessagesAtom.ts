import { atom } from 'jotai';
import { activeChatAtom } from '..'; // Import from the main store index
import type { ChatMessage } from '../../types'; // Assuming types is ../../

export const currentChatMessagesAtom = atom<ChatMessage[]>((get) => {
  const chat = get(activeChatAtom);
  // Ensure messages is always an array, even if chat or chat.messages is null/undefined
  return Array.isArray(chat?.messages) ? chat.messages : [];
});
