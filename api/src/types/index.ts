// src/types/index.ts

export interface BackendChatMessage {
  id: number; // Auto-incremented ID from DB
  chatId: number; // Foreign key
  sender: 'user' | 'ai';
  text: string;
  timestamp: number; // Unix ms timestamp
}

export interface BackendChatSession {
  id: number; // Auto-incremented ID from DB
  sessionId: number; // Foreign key
  timestamp: number; // Unix ms timestamp
  name?: string;
  // Messages are fetched separately when needed, not stored directly on the object
  messages?: BackendChatMessage[]; // Optional: include when returning full chat details
}

// Represents the data stored in the 'sessions' table
export interface BackendSession {
  id: number; // Auto-incremented ID from DB
  fileName: string;
  clientName: string;
  sessionName: string;
  date: string; // YYYY-MM-DD
  sessionType: string;
  therapy: string;
  transcriptPath: string; // Path to the transcript file
   // Chats are fetched separately, not stored directly
   chats?: BackendChatSession[]; // Optional: include when returning full session details
}

// Type used specifically for creating/updating session metadata
export type BackendSessionMetadata = Omit<BackendSession, 'id' | 'transcriptPath' | 'chats' | 'fileName'>;


// Type for the API action schema
export interface ActionSchema {
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    description: string;
    requestBody?: Record<string, unknown> | string; // Allow string for file descriptions
    pathParams?: Record<string, string>;
    queryParams?: Record<string, string>;
    responseBody?: Record<string, unknown> | string;
}

// Error structure for consistent API responses
export interface ApiErrorResponse {
    error: string;
    details?: string;
}
