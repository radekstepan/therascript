// src/types.ts
// Keep other types as they are

export interface ChatMessage {
    id: number;
    sender: 'user' | 'ai';
    text: string;
    starred?: boolean;
    starredName?: string; // Add this field to store the custom name
}

export interface ChatSession {
    id: number;
    timestamp: number;
    name?: string; // Optional name for the chat
    messages: ChatMessage[];
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
    transcription: string;
    chats: ChatSession[];
}

// --- Component Props ---

// Keep UploadModalProps, StarredTemplatesProps, IconProps as they are
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

// Remove LandingPageProps and SessionViewProps if they are empty
// interface LandingPageProps {}
// interface SessionViewProps {}
