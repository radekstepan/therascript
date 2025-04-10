// src/types.ts

export interface BackendChatMessage {
  id: number;
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
}

export interface BackendChatSession {
  id: number;
  sessionId: number;
  timestamp: number;
  name?: string;
  messages?: BackendChatMessage[]; // Optional, loaded on demand
}

export interface BackendSession {
  id: number;
  fileName: string;
  clientName: string;
  sessionName: string;
  date: string;
  sessionType: string;
  therapy: string;
  transcriptPath: string;
  chats?: Pick<BackendChatSession, 'id' | 'sessionId' | 'timestamp' | 'name'>[]; // Optional, only metadata usually loaded
}

// Metadata used for creation/update, excluding generated fields
export type BackendSessionMetadata = Omit<BackendSession, 'id' | 'transcriptPath' | 'chats' | 'fileName'>;


export interface ActionSchema {
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    description: string;
    requestBody?: Record<string, unknown> | string;
    pathParams?: Record<string, string>;
    queryParams?: Record<string, string>;
    responseBody?: Record<string, unknown> | string;
}

export interface ApiErrorResponse {
    error: string;
    details?: string | Record<string, any>; // Allow details object, e.g., for validation
    validationErrors?: any; // Specifically for validation errors
}
