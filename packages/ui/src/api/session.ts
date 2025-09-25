// Purpose: Contains functions for interacting with the backend API endpoints
//          related to Therapy Sessions and their Transcripts (excluding chat interactions).
import axios from 'axios'; // Import Axios for making HTTP requests
import type {
  Session, // UI type for a full session including chat list metadata
  SessionMetadata, // UI type for core session metadata (used for updates)
  StructuredTranscript, // UI type for the array of transcript paragraphs
  UITranscriptionStatus, // UI type for transcription job status
} from '../types'; // Import UI type definitions

/**
 * Fetches a list of all sessions (metadata only) from the backend.
 * Makes a GET request to `/api/sessions/`.
 *
 * @returns {Promise<Session[]>} A promise resolving to an array of Session objects (with empty `chats` array).
 * @throws {Error} If the API request fails.
 */
export const fetchSessions = async (): Promise<Session[]> => {
  // Backend returns an array of session metadata
  const response = await axios.get<Omit<Session, 'chats'>[]>('/api/sessions/');
  // Map response to ensure the 'chats' property exists as an empty array for the UI type
  return response.data.map((sessionMeta: Omit<Session, 'chats'>) => ({
    ...sessionMeta,
    chats: [], // Ensure `chats` property exists, even if empty for list view
  }));
};

/**
 * Uploads a new session (audio file + metadata) to the backend.
 * Starts the transcription process.
 * Makes a POST request to `/api/sessions/upload` with multipart/form-data.
 *
 * @param {File} file - The audio file to upload.
 * @param {SessionMetadata} metadata - Core metadata for the new session.
 * @returns {Promise<{ sessionId: number; jobId: string; message: string }>} A promise resolving to the new session ID, the transcription job ID, and a confirmation message.
 * @throws {Error} If the API request fails.
 */
export const uploadSession = async (
  file: File,
  metadata: SessionMetadata
): Promise<{ sessionId: number; jobId: string; message: string }> => {
  // Create FormData object to send file and metadata
  const formData = new FormData();
  formData.append('audioFile', file);
  // Append metadata fields to the form data
  Object.entries(metadata).forEach(([key, value]) =>
    formData.append(key, value)
  );

  // Make POST request with FormData
  const response = await axios.post('/api/sessions/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }, // Set correct content type
  });
  // Return the data containing sessionId, jobId, and message
  return response.data;
};

/**
 * Finalizes a session after transcription is complete.
 * This triggers the backend to fetch the structured transcript, calculate token count,
 * update the session status, and potentially create an initial chat.
 * Makes a POST request to `/api/sessions/{sessionId}/finalize`.
 *
 * @param {number} sessionId - The ID of the session to finalize.
 * @returns {Promise<Session>} A promise resolving to the fully populated Session object after finalization.
 * @throws {Error} If the API request fails.
 */
export const finalizeSession = async (sessionId: number): Promise<Session> => {
  const response = await axios.post<Session>(
    `/api/sessions/${sessionId}/finalize`
  );
  // Ensure the returned Session object always has a `chats` array, even if empty
  return { ...response.data, chats: response.data.chats || [] };
};

/**
 * Fetches the full details for a specific session, including metadata and a list of associated chat metadata.
 * Makes a GET request to `/api/sessions/{sessionId}`.
 *
 * @param {number} sessionId - The ID of the session to fetch.
 * @returns {Promise<Session>} A promise resolving to the Session object.
 * @throws {Error} If the API request fails or the session is not found (404).
 */
export const fetchSession = async (sessionId: number): Promise<Session> => {
  const response = await axios.get(`/api/sessions/${sessionId}`);
  // Ensure the returned Session object always has a `chats` array
  return { ...response.data, chats: response.data.chats || [] };
};

/**
 * Fetches the structured transcript content for a specific session.
 * Makes a GET request to `/api/sessions/{sessionId}/transcript`.
 *
 * @param {number} sessionId - The ID of the session whose transcript to fetch.
 * @returns {Promise<StructuredTranscript>} A promise resolving to the structured transcript array.
 * @throws {Error} If the API request fails.
 */
export const fetchTranscript = async (
  sessionId: number
): Promise<StructuredTranscript> => {
  const response = await axios.get<StructuredTranscript>(
    `/api/sessions/${sessionId}/transcript`
  );
  return response.data;
};

/**
 * Updates the metadata for a specific session.
 * Makes a PUT request to `/api/sessions/{sessionId}/metadata`.
 *
 * @param {number} sessionId - The ID of the session to update.
 * @param {Partial<SessionMetadata & { audioPath?: string | null; transcriptTokenCount?: number | null }>} metadata - An object containing the metadata fields to update. Can include audioPath and transcriptTokenCount.
 * @returns {Promise<SessionMetadata>} A promise resolving to the updated session metadata.
 * @throws {Error} If the API request fails.
 */
export const updateSessionMetadata = async (
  sessionId: number,
  metadata: Partial<
    SessionMetadata & {
      audioPath?: string | null;
      transcriptTokenCount?: number | null;
    }
  >
): Promise<SessionMetadata> => {
  // Return type reflects backend (metadata only)
  const response = await axios.put(
    `/api/sessions/${sessionId}/metadata`,
    metadata
  );
  // The backend returns only the core metadata part of the session
  return response.data;
};

/**
 * Updates the text of a specific paragraph within a session's transcript.
 * Makes a PATCH request to `/api/sessions/{sessionId}/transcript`.
 *
 * @param {number} sessionId - The ID of the session.
 * @param {number} paragraphIndex - The index of the paragraph to update.
 * @param {string} newText - The new text content for the paragraph.
 * @returns {Promise<StructuredTranscript>} A promise resolving to the *entire* updated structured transcript after the change.
 * @throws {Error} If the API request fails.
 */
export const updateTranscriptParagraph = async (
  sessionId: number,
  paragraphIndex: number,
  newText: string
): Promise<StructuredTranscript> => {
  const response = await axios.patch<StructuredTranscript>(
    `/api/sessions/${sessionId}/transcript`,
    { paragraphIndex, newText }
  );
  // Backend returns the full updated transcript
  return response.data;
};

/**
 * Deletes a specific paragraph from a session's transcript.
 * Makes a DELETE request to `/api/sessions/{sessionId}/transcript/{paragraphIndex}`.
 *
 * @param {number} sessionId - The ID of the session.
 * @param {number} paragraphIndex - The index of the paragraph to delete.
 * @returns {Promise<StructuredTranscript>} A promise resolving to the *entire* updated structured transcript after deletion.
 * @throws {Error} If the API request fails.
 */
export const deleteTranscriptParagraph = async (
  sessionId: number,
  paragraphIndex: number
): Promise<StructuredTranscript> => {
  const response = await axios.delete<StructuredTranscript>(
    `/api/sessions/${sessionId}/transcript/${paragraphIndex}`
  );
  return response.data;
};

/**
 * Deletes the original uploaded audio file associated with a session.
 * Makes a DELETE request to `/api/sessions/{sessionId}/audio`.
 * Note: This only deletes the file; the session record itself remains unless deleted separately.
 *
 * @param {number} sessionId - The ID of the session whose audio file to delete.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the API request fails (e.g., file not found, permissions error).
 */
export const deleteSessionAudio = async (
  sessionId: number
): Promise<{ message: string }> => {
  const response = await axios.delete(`/api/sessions/${sessionId}/audio`);
  return response.data;
};

/**
 * Deletes an entire session, including its metadata, associated chats, messages, transcript paragraphs, and the original audio file.
 * Makes a DELETE request to `/api/sessions/{sessionId}`.
 *
 * @param {number} sessionId - The ID of the session to delete.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the API request fails.
 */
export const deleteSession = async (
  sessionId: number
): Promise<{ message: string }> => {
  const response = await axios.delete(`/api/sessions/${sessionId}`);
  return response.data;
};
