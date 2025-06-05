// packages/ui/src/api/system.ts
import axios from 'axios';

// This should match the port exposed by run-dev.js and run-prod.js
const SHUTDOWN_SERVICE_URL = 'http://localhost:9999';

/**
 * Sends a request to the backend script's shutdown service.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the API request fails or the service is unreachable.
 */
export const requestAppShutdown = async (): Promise<{ message: string }> => {
  try {
    // Explicitly set Content-Type to text/plain for the POST request
    // to help avoid CORS preflight if the server is very simple.
    // However, the server-side CORS headers are the more robust solution.
    const response = await axios.post(
      `${SHUTDOWN_SERVICE_URL}/shutdown`,
      null, // No actual body content needed for this request
      {
        headers: {
          'Content-Type': 'text/plain',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error requesting app shutdown:', error);
    if (axios.isAxiosError(error)) {
      if (!error.response) {
        // Network error (e.g., server not running)
        throw new Error(
          'Shutdown service is not reachable. Is the application running?'
        );
      } else {
        // Server responded with an error status
        const responseErrorMessage =
          typeof error.response.data === 'object' &&
          error.response.data !== null &&
          'message' in error.response.data &&
          typeof error.response.data.message === 'string'
            ? error.response.data.message
            : error.message;
        throw new Error(
          `Shutdown request failed: ${error.response.status} ${responseErrorMessage}`
        );
      }
    }
    // Fallback for non-Axios errors
    if (error instanceof Error) {
      throw new Error(`Failed to send shutdown request: ${error.message}`);
    }
    // Handle cases where error is not an Error instance
    throw new Error(
      `Failed to send shutdown request: An unknown error occurred.`
    );
  }
};
