export { SessionView } from './SessionView'; // Explicitly export SessionView

// Export SessionContent separately if needed elsewhere,
// otherwise it's primarily used within SessionView
export { SessionContent } from './SessionContent'; // Explicitly export SessionContent

// Chat Components
export * from './Chat/ChatHeader';
export * from './Chat/ChatInput';
export * from './Chat/ChatMessages';
export * from './Chat/ChatInterface';
export * from './Chat/StarredTemplates';
export * from './Chat/StartChatPrompt';

// Sidebar Components
export * from './Sidebar/SessionSidebar';
export * from './Sidebar/PastChatsList';

// Transcription Components
export * from './Transcription/Transcription';
// Note: Assuming TranscriptParagraph is potentially reusable outside SessionView,
// it might live in src/components/Transcription/TranscriptParagraph.tsx
// If it's *only* used here, it could be nested inside SessionView/Transcription/
// export * from '../Transcription/TranscriptParagraph'; // Or './Transcription/TranscriptParagraph' if nested

// Modal Components
export * from './Modals/EditDetailsModal';
