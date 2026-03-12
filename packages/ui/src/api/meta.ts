// Purpose: Contains functions for interacting with the backend API endpoints
//          related to general metadata, health checks, or other miscellaneous actions.
import axios from 'axios'; // Import Axios for making HTTP requests
import type { ReadinessStatus } from '../types';

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

/**
 * Fetches the readiness status of all backend services.
 * Makes a GET request to `/api/status/readiness`.
 * @returns {Promise<ReadinessStatus>} Readiness status object.
 * @throws {Error} If the API request fails.
 */
export const fetchReadinessStatus = async (): Promise<ReadinessStatus> => {
  // Accept 503 as a valid response — the body still contains {ready, services}
  // so the overlay can show which services are down instead of showing a
  // generic error and blocking the UI permanently.
  const response = await axios.get<ReadinessStatus>('/api/status/readiness', {
    validateStatus: (status) => status === 200 || status === 503,
  });
  const data = response.data as any;
  const hasValidShape =
    data &&
    typeof data === 'object' &&
    typeof data.ready === 'boolean' &&
    data.services &&
    typeof data.services === 'object';

  if (!hasValidShape) {
    throw new Error('Invalid readiness response from backend');
  }

  return data as ReadinessStatus;
};

// Placeholder for potential future meta API calls
export const placeholderMetaCall = async () => {
  return { status: 'ok' };
};
