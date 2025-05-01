// =========================================
// File: packages/ui/src/api/docker.ts
// NEW FILE - Contains API calls related to Docker Management
// =========================================
import axios from 'axios';
import type { DockerContainerStatus } from '../types';

// GET /api/docker/status
export const fetchDockerStatus = async (): Promise<DockerContainerStatus[]> => {
    const response = await axios.get<{ containers: DockerContainerStatus[] }>('/api/docker/status');
    return response.data.containers;
};
