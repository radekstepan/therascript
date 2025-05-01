// Purpose: Contains functions for interacting with the backend API endpoints
//          related to Docker container management.
import axios from 'axios'; // Import Axios for making HTTP requests
import type { DockerContainerStatus } from '../types'; // Import the UI type definition for Docker status

/**
 * Fetches the status of project-related Docker containers from the backend API.
 * Makes a GET request to `/api/docker/status`.
 *
 * @returns {Promise<DockerContainerStatus[]>} A promise that resolves to an array of Docker container status objects.
 * @throws {Error} If the API request fails.
 */
export const fetchDockerStatus = async (): Promise<DockerContainerStatus[]> => {
  // Make a GET request to the backend endpoint
  const response = await axios.get<{ containers: DockerContainerStatus[] }>(
    '/api/docker/status'
  );
  // Return the 'containers' array from the response data
  return response.data.containers;
};
