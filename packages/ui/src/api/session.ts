// =========================================
// File: packages/ui/src/api/session.ts
// NEW FILE - Contains API calls related to Sessions and Transcripts (excluding chat)
// =========================================
import axios from 'axios';
import type {
    Session,
    SessionMetadata,
    StructuredTranscript,
    UITranscriptionStatus,
} from '../types';

// GET /api/sessions/
export const fetchSessions = async (): Promise<Session[]> => {
    const response = await axios.get('/api/sessions/');
    // Map to ensure 'chats' exists, even if empty
    return response.data.map((sessionMeta: any) => ({
        ...sessionMeta,
        chats: [], // List view doesn't include chats
    }));
};

// POST /api/sessions/upload
export const uploadSession = async (file: File, metadata: SessionMetadata): Promise<{ sessionId: number; jobId: string; message: string }> => {
    const formData = new FormData();
    formData.append('audioFile', file);
    Object.entries(metadata).forEach(([key, value]) => formData.append(key, value));
    const response = await axios.post('/api/sessions/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
};

// POST /api/sessions/{sessionId}/finalize
export const finalizeSession = async (sessionId: number): Promise<Session> => {
    const response = await axios.post<Session>(`/api/sessions/${sessionId}/finalize`);
     return { ...response.data, chats: response.data.chats || [] }; // Ensure chats array exists
};

// GET /api/sessions/{sessionId}
export const fetchSession = async (sessionId: number): Promise<Session> => {
    const response = await axios.get(`/api/sessions/${sessionId}`);
    return { ...response.data, chats: response.data.chats || [] }; // Ensure chats array exists
};

// GET /api/sessions/{sessionId}/transcript
export const fetchTranscript = async (sessionId: number): Promise<StructuredTranscript> => {
    const response = await axios.get<StructuredTranscript>(`/api/sessions/${sessionId}/transcript`);
    return response.data;
};

// PUT /api/sessions/{sessionId}/metadata
export const updateSessionMetadata = async (sessionId: number, metadata: Partial<SessionMetadata & { audioPath?: string | null; transcriptTokenCount?: number | null }>): Promise<SessionMetadata> => {
    const response = await axios.put(`/api/sessions/${sessionId}/metadata`, metadata);
    return response.data; // Returns only the metadata part
};

// PATCH /api/sessions/{sessionId}/transcript
export const updateTranscriptParagraph = async (sessionId: number, paragraphIndex: number, newText: string): Promise<StructuredTranscript> => {
    const response = await axios.patch<StructuredTranscript>(`/api/sessions/${sessionId}/transcript`, { paragraphIndex, newText });
    return response.data;
};

// DELETE /api/sessions/{sessionId}/audio
export const deleteSessionAudio = async (sessionId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/sessions/${sessionId}/audio`);
    return response.data;
};

// DELETE /api/sessions/{sessionId}
export const deleteSession = async (sessionId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/sessions/${sessionId}`);
    return response.data;
};
