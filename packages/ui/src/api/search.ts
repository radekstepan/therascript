// Purpose: Contains functions for interacting with the backend API endpoints
//          related to searching across messages and transcripts.
import axios from 'axios'; // Import Axios for making HTTP requests
import type { SearchApiResponse } from '../types'; // Import the specific UI type for the search response

/**
 * Performs a full-text search across messages and transcripts via the backend API.
 * Makes a GET request to `/api/search`.
 *
 * @param {string} query - The search query string.
 * @param {number} [limit=20] - The maximum number of results to return. Defaults to 20.
 * @returns {Promise<SearchApiResponse>} A promise resolving to the search results object, containing the original query and an array of result items.
 * @throws {Error} If the API request fails.
 */
export const searchMessages = async (
  query: string,
  limit: number = 20
): Promise<SearchApiResponse> => {
  // Make a GET request with query parameters
  const response = await axios.get<SearchApiResponse>('/api/search', {
    params: {
      q: query, // The search term
      limit: limit, // Max results
    },
  });
  // Return the data part of the response, which should match SearchApiResponse
  return response.data;
};
