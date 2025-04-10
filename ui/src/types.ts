// src/types.ts

export interface ChatMessage {
    id: number; // Matches API
    sender: 'user' | 'ai'; // Matches API
    text: string; // Matches API
    timestamp?: number; // Matches API (Optional in base message, check if present)
    starred?: boolean; // Frontend state, not in API base response
    starredName?: string; // Frontend state
    // Ensure chatId is present if API sends it, else it's inferred
    chatId?: number; // Matches API
}

export interface ChatSession {
    id: number; // Matches API
    timestamp: number; // Matches API
    name?: string | null; // Matches API (allows null)
    messages: ChatMessage[]; // Assumes API sends this in the full session response
    sessionId?: number; // Matches API
}

export interface SessionMetadata {
    clientName: string;
    sessionName: string;
    date: string;
    sessionType: string;
    therapy: string;
}

export interface Session extends SessionMetadata {
    id: number;
    fileName: string;
    transcriptContent: string; // Corrected field name
    chats: ChatSession[]; // Array of chat sessions
}

// --- Component Props ---
export interface UploadModalProps {
    isOpen: boolean;
    isTranscribing: boolean;
    transcriptionError: string;
}

export interface StarredTemplatesProps {
    onSelectTemplate: (text: string) => void;
    onClose: () => void;
}

export interface IconProps {
    size?: number;
    className?: string;
    filled?: boolean;
}
