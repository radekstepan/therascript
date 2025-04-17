export { SessionView } from './SessionView'; // Explicitly export SessionView
export { SessionContent } from './SessionContent'; // Explicitly export SessionContent

// Chat Components
// export * from './Chat/ChatHeader'; // Keep commented or remove old header
export * from './Chat/ChatPanelHeader'; // Export new header
export * from './Chat/ChatInput';
export * from './Chat/ChatMessages';
export * from './Chat/ChatInterface';
export * from './Chat/StarredTemplates';
export * from './Chat/StartChatPrompt';

// Sidebar Components
export * from './Sidebar/SessionSidebar';
// Removed PastChatsList export as it seems integrated into SessionSidebar

// Transcription Components
export * from './Transcription/Transcription';
// Assuming TranscriptParagraph lives in its own folder now
// export * from '../Transcription/TranscriptParagraph';

// Modal Components
export * from './Modals/EditDetailsModal';
export * from './Modals/LlmManagementModal'; // Export new modal
