// =========================================
// File: packages/ui/src/api/transcription.ts
// =========================================
import axios from 'axios';
import type { UITranscriptionStatus } from '../types'; // <-- Import moved type

// GET /api/transcription/status/{jobId}
export const fetchTranscriptionStatus = async (jobId: string): Promise<UITranscriptionStatus> => {
    const response = await axios.get<UITranscriptionStatus>(`/api/transcription/status/${jobId}`);
    return response.data;
};
