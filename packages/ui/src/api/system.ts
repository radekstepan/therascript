// Purpose: Contains functions for interacting with the backend API endpoints
//          related to system-level actions (e.g., shutdown).
// =========================================
import axios from 'axios'; // Import Axios for making HTTP requests

/**
 * Sends a request to the backend API to trigger a system shutdown.
 * Makes a POST request to `/api/system/shutdown`.
 * Requires the backend API process to have appropriate sudo permissions.
 * USE WITH CAUTION.
 *
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message from the backend.
 * @throws {Error} If the API request fails (e.g., network error, permission error (503), server error (500)).
 */
export const triggerShutdown = async (): Promise<{ message: string }> => {
  // Make a POST request to the shutdown endpoint
  const response = await axios.post<{ message: string }>(
    '/api/system/shutdown'
  );
  // Return the message from the response data
  return response.data;
};
