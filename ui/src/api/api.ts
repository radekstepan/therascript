// src/api/api.ts
import axios from 'axios';
import type { Session, SessionMetadata, ChatSession, ChatMessage } from '../types';

// GET /api/sessions/
export const fetchSessions = async (): Promise<Session[]> => {
  const response = await axios.get('/api/sessions/');
  return response.data;
};

// POST /api/sessions/upload
export const uploadSession = async (file: File, metadata: SessionMetadata): Promise<Session> => {
  const formData = new FormData();
  formData.append('audioFile', file);
  Object.entries(metadata).forEach(([key, value]) => formData.append(key, value));
  const response = await axios.post('/api/sessions/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

// GET /api/sessions/{sessionId}
export const fetchSession = async (sessionId: number): Promise<Session> => {
  const response = await axios.get(`/api/sessions/${sessionId}`);
  return response.data;
};

// PUT /api/sessions/{sessionId}/metadata
export const updateSessionMetadata = async (
  sessionId: number,
  metadata: Partial<SessionMetadata>
): Promise<SessionMetadata> => {
  const response = await axios.put(`/api/sessions/${sessionId}/metadata`, metadata);
  return response.data;
};

// PATCH /api/sessions/{sessionId}/transcript
export const updateTranscript = async (
  sessionId: number,
  paragraphIndex: number,
  newText: string
): Promise<string> => {
  const response = await axios.patch(`/api/sessions/${sessionId}/transcript`, { paragraphIndex, newText });
  return response.data.transcriptContent;
};

// POST /api/sessions/{sessionId}/chats/
export const startNewChat = async (sessionId: number): Promise<ChatSession> => {
  const response = await axios.post(`/api/sessions/${sessionId}/chats/`);
  return response.data;
};

// POST /api/sessions/{sessionId}/chats/{chatId}/messages
export const addChatMessage = async (
  sessionId: number,
  chatId: number,
  text: string
): Promise<{ userMessage: ChatMessage; aiMessage: ChatMessage }> => {
  const response = await axios.post(`/api/sessions/${sessionId}/chats/${chatId}/messages`, { text });
  return response.data;
};

// PATCH /api/sessions/{sessionId}/chats/{chatId}/name
export const renameChat = async (sessionId: number, chatId: number, name: string | null): Promise<ChatSession> => {
  const response = await axios.patch(`/api/sessions/${sessionId}/chats/${chatId}/name`, { name });
  return response.data;
};

// DELETE /api/sessions/{sessionId}/chats/{chatId}
export const deleteChat = async (sessionId: number, chatId: number): Promise<{ message: string }> => {
  const response = await axios.delete(`/api/sessions/${sessionId}/chats/${chatId}`);
  return response.data;
};
