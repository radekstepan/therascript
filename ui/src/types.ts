// src/types.ts

export interface ChatMessage {
  id: number;
  sender: 'user' | 'ai';
  text: string;
  starred?: boolean; // Optional property
}

export interface ChatSession {
  id: number;
  timestamp: number; // Unix timestamp (milliseconds)
  messages: ChatMessage[];
}

export interface SessionMetadata {
  clientName: string;
  sessionName: string;
  date: string; // Format: "YYYY-MM-DD"
  sessionType: string;
  therapy: string;
}

export interface Session extends SessionMetadata {
  id: number; // Unique session identifier
  fileName: string; // Original uploaded filename
  transcription: string;
  chats: ChatSession[]; // Array of chat conversations for this session
}

// Props type for UploadModal component for better type safety
export interface UploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStartTranscription: (file: File, metadata: SessionMetadata) => Promise<void>; // Explicitly async
    isTranscribing: boolean;
    transcriptionError: string;
}

// Props type for LandingPage
export interface LandingPageProps {
  pastSessions: Session[];
  navigateToSession: (sessionId: number) => void;
  openUploadModal: () => void;
}

// Props type for StarredTemplates component
export interface StarredTemplatesProps {
    starredMessages: Pick<ChatMessage, 'id' | 'text'>[]; // Only need id and text
    onSelectTemplate: (text: string) => void;
    onClose: () => void; // Function to close the template list
}


// Define a type for the chat handlers passed down to SessionView
export interface ChatHandlers {
    chatMessages: ChatMessage[];
    loadChatMessages: (messages: ChatMessage[]) => void;
    currentQuery: string;
    setCurrentQuery: React.Dispatch<React.SetStateAction<string>>;
    isChatting: boolean;
    chatError: string;
    handleChatSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>; // Explicitly async
}

// Props type for SessionView
export interface SessionViewProps {
    sessionId: number;
    activeChatId: number | null;
    setActiveChatIdHandler: (chatId: number | null) => void;
    pastSessions: Session[];
    navigateBack: () => void;
    chatHandlers: ChatHandlers;
    onSaveMetadata: (sessionId: number, updatedMetadata: Omit<Session, 'id' | 'fileName' | 'transcription' | 'chats'>) => void;
    onSaveTranscript: (sessionId: number, newTranscript: string) => void;
    starredMessages: Pick<ChatMessage, 'id' | 'text'>[];
    onStarMessage: (chatId: number, messageId: number, messageText: string, shouldStar: boolean) => void;
}

// Props for individual UI components (basic examples)
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    variant?: 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon';
}

export interface CardElementProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    className?: string;
}

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
     children: React.ReactNode;
     className?: string;
     as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; // Allow different heading levels
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    className?: string;
}

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
     children: React.ReactNode;
     className?: string;
}

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
     children: React.ReactNode;
     className?: string;
     elRef?: React.Ref<HTMLDivElement>; // Pass ref for scrolling control
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    children: React.ReactNode;
    className?: string;
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    className?: string;
}

// Props for Icons
export interface IconProps {
    size?: number;
    className?: string;
    filled?: boolean; // Specific to Star icon
}
