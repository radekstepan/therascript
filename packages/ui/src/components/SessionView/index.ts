// packages/ui/src/components/SessionView/index.ts
export { SessionView } from './SessionView';
export { SessionContent } from './SessionContent';

// Chat Components
export * from './Chat/ChatPanelHeader'; // Export new header
export * from './Chat/ChatInput';
export * from './Chat/ChatMessages';
export * from './Chat/ChatInterface';
export * from './Chat/StarredTemplatesList'; // Corrected path
export * from './Chat/StartChatPrompt';
export * from './Chat/ChatMessageBubble';

// Sidebar Components
// SessionSidebar is removed
// PastChatsList is removed/integrated

// Transcription Components
export * from './Transcription/Transcription';

// Modal Components
export * from './Modals/LlmManagementModal';
export * from './Modals/SelectActiveModelModal';
