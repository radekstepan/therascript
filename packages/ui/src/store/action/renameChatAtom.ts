import { atom } from 'jotai';
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    chatErrorAtom
} from '..';
import { renameChat as renameChatApi } from '../../api/api';

export const renameChatAtom = atom(null, async (get, set, payload: { chatId: number; newName: string }) => {
    const { chatId, newName } = payload;
    const sessionId = get(activeSessionIdAtom);

    if (sessionId === null) {
        console.error("Cannot rename chat: No active session.");
        set(chatErrorAtom, "Cannot rename chat: No active session.");
        return;
    }

    try {
        const updatedChat = await renameChatApi(sessionId, chatId, newName.trim() || null);
        set(pastSessionsAtom, (prev) =>
            prev.map((s) =>
                s.id === sessionId
                    ? {
                        ...s,
                        // Ensure chats is an array
                        // TODO should be typed automatically
                        chats: (Array.isArray(s.chats) ? s.chats : []).map((c) =>
                            c.id === chatId ? { ...c, name: updatedChat.name } : c // Update name
                        ),
                    }
                    : s
            )
        );
    } catch (err) {
        console.error(`Failed to rename chat ${chatId}:`, err);
        set(chatErrorAtom, "Failed to rename chat.");
    }
});
