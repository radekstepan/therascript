// Purpose: Contains functions for interacting with the backend API endpoints
//          related to general metadata, health checks, or other miscellaneous actions.
import axios from 'axios'; // Import Axios for making HTTP requests

// --- Health Check (Optional) ---
/**
 * Pings the backend health check endpoint.
 * Makes a GET request to `/api/health`.
 * Could be used for UI status indicators if needed.
 *
 * @returns {Promise<{ status: string; database: string; timestamp: string }>} Health status object.
 * @throws {Error} If the API request fails.
 */
export const checkApiHealth = async (): Promise<{
  status: string;
  database: string;
  timestamp: string;
}> => {
  const response = await axios.get('/api/health');
  return response.data;
};
// --- End Health Check ---

// Placeholder for potential future meta API calls
export const placeholderMetaCall = async () => {
  return { status: 'ok' };
};
