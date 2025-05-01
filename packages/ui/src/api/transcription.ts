// Purpose: Contains functions for interacting with the backend API endpoints
//          related to monitoring transcription job status.
import axios from 'axios'; // Import Axios for making HTTP requests
import type { UITranscriptionStatus } from '../types'; // Import the specific UI type definition for transcription status

/**
 * Fetches the current status of a specific transcription job from the backend.
 * Makes a GET request to `/api/transcription/status/{jobId}`.
 *
 * @param {string} jobId - The ID of the transcription job to check.
 * @returns {Promise<UITranscriptionStatus>} A promise resolving to the transcription job status object.
 * @throws {Error} If the API request fails (e.g., job not found (404), server error).
 */
export const fetchTranscriptionStatus = async (
  jobId: string
): Promise<UITranscriptionStatus> => {
  // Make a GET request to the specific job status endpoint
  const response = await axios.get<UITranscriptionStatus>(
    `/api/transcription/status/${jobId}`
  );
  // Return the data part of the response, which should match UITranscriptionStatus
  return response.data;
};
