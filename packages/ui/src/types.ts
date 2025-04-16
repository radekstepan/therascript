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
    // transcription field is removed - it's fetched separately now as structured data
    // transcription: string; // REMOVED
    // Chats array might initially contain only metadata (ChatSession without messages)
    // Ensure chats array elements conform to the updated ChatSession type
    chats: ChatSession[];
    transcriptPath: string; // Keep path if needed, points to JSON now
}
