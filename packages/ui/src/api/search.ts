// =========================================
// File: packages/ui/src/api/search.ts
// NEW FILE - Contains API calls related to Search
// =========================================
import axios from 'axios';
import type { SearchApiResponse } from '../types';

// GET /api/search
export const searchMessages = async (query: string, limit: number = 20): Promise<SearchApiResponse> => {
    const response = await axios.get<SearchApiResponse>('/api/search', {
        params: { q: query, limit }
    });
    return response.data;
};
