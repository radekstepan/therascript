// Purpose: Contains functions for interacting with the backend API endpoints
//          related to general metadata, health checks, or other miscellaneous actions.
import axios from 'axios'; // Import Axios for making HTTP requests
import type { ChatMessage } from '../types'; // Using UI type

// --- Starred Messages Fetching (Moved from chat.ts) ---
/**
 * Fetches all starred messages (templates) from the backend.
 * Makes a GET request to `/api/starred-messages`.
 *
 * @returns {Promise<ChatMessage[]>} A promise resolving to an array of starred message objects.
 * @throws {Error} If the API request fails.
 */
export const fetchStarredMessages = async (): Promise<ChatMessage[]> => {
    // Backend response uses BackendChatMessage type, we map it here
    const response = await axios.get<any[]>('/api/starred-messages'); // Use any[] for initial flexibility
    return (response.data || []).map(m => ({
        ...m,
        starred: !!m.starred, // Ensure boolean type
        starredName: m.starredName === undefined ? undefined : m.starredName, // Preserve undefined
    }));
};
// --- End Starred Messages Fetching ---


// --- Health Check (Optional) ---
/**
 * Pings the backend health check endpoint.
 * Makes a GET request to `/api/health`.
 * Could be used for UI status indicators if needed.
 *
 * @returns {Promise<{ status: string; database: string; timestamp: string }>} Health status object.
 * @throws {Error} If the API request fails.
 */
export const checkApiHealth = async (): Promise<{ status: string; database: string; timestamp: string }> => {
    const response = await axios.get('/api/health');
    return response.data;
};
// --- End Health Check ---

// Placeholder for potential future meta API calls
export const placeholderMetaCall = async () => { return { status: 'ok' }; };
