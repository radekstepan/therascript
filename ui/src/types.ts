// src/types.ts

export interface ChatMessage {
    id: number;
    sender: 'user' | 'ai';
    text: string;
    starred?: boolean;
    starredName?: string; // Add this field to store the custom name
}

export interface ChatSession {
    id: number;
    timestamp: number; // Keep timestamp for sorting/display
    name?: string; // Optional name for the chat
    // Messages are optional, as they might be loaded on demand when a chat is selected
    messages?: ChatMessage[];
}

export interface SessionMetadata {
    clientName: string;
    sessionName: string;
    date: string;
    sessionType: string;
    therapy: string;
}

// Ensure this Session interface definitely includes transcription
export interface Session extends SessionMetadata {
    id: number;
    fileName: string;
    transcription: string;
    // Chats array might initially contain only metadata (ChatSession without messages)
    chats: ChatSession[];
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
