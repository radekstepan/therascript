// =========================================
// File: packages/ui/src/api/system.ts
// NEW FILE - Contains API calls related to System Management
// =========================================
import axios from 'axios';

// POST /api/system/shutdown
export const triggerShutdown = async (): Promise<{ message: string }> => {
    const response = await axios.post<{ message: string }>('/api/system/shutdown');
    return response.data;
};
