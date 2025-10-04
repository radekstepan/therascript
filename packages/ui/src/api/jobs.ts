// packages/ui/src/api/jobs.ts
import axios from 'axios';
import type { ActiveJobCount } from '../types';

export const fetchActiveJobCount = async (): Promise<ActiveJobCount> => {
  const response = await axios.get('/api/jobs/active-count');
  return response.data;
};
