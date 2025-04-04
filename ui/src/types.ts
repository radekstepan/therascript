// Removed View type as routing handles it
// export type View = 'landing' | 'session';

export interface ChatMessage {
    id: number;
    sender: 'user' | 'ai';
    text: string;
    starred?: boolean;
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

// --- Component Props (Keep only props not handled by Jotai atoms) ---

// No longer needs props managed by Jotai
export interface LandingPageProps {
    // Props removed: pastSessions, navigateToSession, openUploadModal
}

// SessionView no longer needs props, it gets IDs from URL params
export interface SessionViewProps {
    // Props removed
}

// Keep props that App needs to pass down for display/status
export interface UploadModalProps {
    isOpen: boolean;
    isTranscribing: boolean;
    transcriptionError: string;
    // Props removed: onClose, onStartTranscription (now handled via atoms/navigation)
}

// Keep props needed for interaction callbacks from SessionView
export interface StarredTemplatesProps {
    // Props removed: starredMessages (reads atom directly)
    onSelectTemplate: (text: string) => void;
    onClose: () => void;
}


// --- UI Component Prop Types (Unchanged) ---
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
