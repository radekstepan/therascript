// packages/api/src/api/systemHandler.ts
import { executeShutdown } from '../services/systemService.js';
import { InternalServerError, ApiError } from '../errors.js';

/**
 * Handles the API request to trigger a system shutdown.
 * Calls the systemService to execute the command.
 */
export const handleShutdownRequest = async ({ set }: any): Promise<{ message: string }> => {
    console.log("[API System] Received shutdown request.");
    try {
        const result = await executeShutdown();
        set.status = 200; // Or 202 Accepted if it takes time
        // The system might shut down before this response is fully sent
        return result;
    } catch (error) {
        console.error("[API Error] handleShutdownRequest:", error);
        // Rethrow specific ApiErrors (like 503 for permissions) or InternalServerError
        if (error instanceof ApiError) {
            throw error;
        }
        throw new InternalServerError('Failed to initiate system shutdown.', error instanceof Error ? error : undefined);
    }
};
