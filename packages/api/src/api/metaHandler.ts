// =========================================
// File: packages/api/src/api/metaHandler.ts
// =========================================
/* packages/api/src/api/metaHandler.ts */
import { messageRepository } from '../repositories/messageRepository.js'; // <-- Import Message Repo
import { InternalServerError } from '../errors.js';
import type { BackendChatMessage } from '../types/index.js';

// Define response type with boolean starred
type ApiChatMessageResponse = Omit<BackendChatMessage, 'starred'> & { starred: boolean };

// --- Handler for fetching starred messages ---
export const getStarredMessages = ({ set }: any): ApiChatMessageResponse[] => {
    try {
        const starredMessages = messageRepository.findStarredMessages(); // <-- Use messageRepository
        set.status = 200;
        // Map starred number to boolean for API response
        return starredMessages.map(m => {
             const { starred: starredNum, ...rest } = m;
             return {
                 ...rest,
                 starred: !!starredNum,
                 starredName: rest.starredName === undefined ? undefined : rest.starredName, // Preserve undefined
             };
         });
    } catch (error) {
        console.error('[API Error] getStarredMessages:', error);
        throw new InternalServerError('Failed to fetch starred messages', error instanceof Error ? error : undefined);
    }
};
// TODO comments should not be removed
