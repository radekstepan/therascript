import { atom } from 'jotai';
import { activeSessionAtom, activeChatIdAtom } from '..';
import type { ChatSession } from '../../types';

export const activeChatAtom = atom<ChatSession | null>((get) => {
    const session = get(activeSessionAtom);
    const chatId = get(activeChatIdAtom);
    if (!session || chatId === null) return null;
    const chats = Array.isArray(session.chats) ? session.chats : [];
    const foundChat = chats.find((c) => c.id === chatId) ?? null;
    return foundChat;
});
