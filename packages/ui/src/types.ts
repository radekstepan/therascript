// TODO can we infer these from the API?

// Add the new structured transcript types
export interface TranscriptParagraphData {
    id: number; // or index used as ID
    timestamp: number; // start time in milliseconds
    text: string;
}
export type StructuredTranscript = TranscriptParagraphData[];


export interface ChatMessage {
    id: number;
    sender: 'user' | 'ai';
    text: string;
    starred?: boolean;
    starredName?: string;
}

export interface ChatSession {
    id: number;
    sessionId: number; // Added sessionId
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

export interface Session extends SessionMetadata {
    id: number;
    fileName: string;
    // transcriptPath can be null if transcription is pending/failed
    transcriptPath: string | null;
    // Add status and whisperJobId to match backend
    status: 'pending' | 'transcribing' | 'completed' | 'failed';
    whisperJobId: string | null;
    // Chats array might initially contain only metadata
    chats: ChatSession[];
}
