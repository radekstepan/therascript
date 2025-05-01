import { executeShutdown } from '../services/systemService.js';
import { InternalServerError, ApiError } from '../errors.js';

/**
 * Handles the API request to trigger a system shutdown.
 * Calls the systemService to execute the command.
 *
 * @param {object} context - Elysia context object, contains `set` for modifying response status.
 * @returns {Promise<{ message: string }>} A promise resolving to a success message.
 * @throws {ApiError|InternalServerError} Throws specific errors if shutdown fails or permissions are insufficient.
 */
export const handleShutdownRequest = async ({ set }: any): Promise<{ message: string }> => {
    console.log("[API System] Received shutdown request.");
    try {
        const result = await executeShutdown();
        // Note: The system might shut down before this response is fully sent.
        set.status = 200; // Or 202 Accepted if it takes time, but immediate shutdown is expected.
        return result;
    } catch (error) {
        console.error("[API Error] handleShutdownRequest:", error);
        // Rethrow specific ApiErrors (like 503 for permissions) or InternalServerError
        if (error instanceof ApiError) {
            throw error;
        }
        // Wrap other errors in InternalServerError for consistent API response
        throw new InternalServerError('Failed to initiate system shutdown.', error instanceof Error ? error : undefined);
    }
};
