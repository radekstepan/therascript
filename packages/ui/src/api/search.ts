import axios from 'axios';
import type { SearchApiResponse } from '../types'; // Use the type from UI types

export const searchMessages = async (
  query: string,
  limit: number = 20,
  from: number = 0,
  clientName?: string,
  // tags?: string[], // Removed tags parameter
  searchType?: 'chat' | 'transcript' | 'all'
): Promise<SearchApiResponse> => {
  const params: Record<string, any> = {
    q: query,
    limit: limit,
    from: from,
  };
  if (clientName) params.clientName = clientName;
  // if (tags && tags.length > 0) params.tags = tags; // Removed tags logic
  if (searchType) params.searchType = searchType;

  const response = await axios.get<SearchApiResponse>('/api/search', {
    params,
  });
  return response.data;
};
