# SessionView Component Folder Context

## Purpose

This folder contains all the React components necessary to render the detailed view for a single therapy **Session**. This view typically displays the session's transcription alongside an interactive chat interface allowing the user (therapist) to ask questions about the session content, powered by an AI.

## Core Components

*   **`SessionView.tsx`**: The main container and entry point for this feature. It orchestrates data fetching (session details, transcript, chat messages), manages overall loading states, handles routing parameters (`sessionId`, `chatId`), manages sidebar resizing, and renders the main layout structure (Sidebar + Content). It also houses the state and logic for the `EditDetailsModal`.
*   **`SessionContent.tsx`**: Responsible for the main content area's layout. It displays either a side-by-side view (Transcription + Chat) on larger screens or a tabbed view on smaller screens. It passes down necessary data and callbacks to the `ChatInterface` and `Transcription` components.

## Subfolders

### `/Chat`

Contains components related to the AI chat interface for the session.

*   **`ChatInterface.tsx`**: Manages the overall chat area, including the scrollable message display and the input field. Handles scrolling behavior (saving position, scrolling to bottom) and displays loading states for messages.
*   **`ChatHeader.tsx`**: Displays the title of the currently active chat (e.g., "Chat (Timestamp)" or a custom name).
*   **`ChatInput.tsx`**: The text input field for sending messages to the AI. Includes functionality for using starred templates, handling message submission, displaying errors, and showing loading/cancel states during AI response generation.
*   **`ChatMessages.tsx`**: Renders the list of messages (user and AI) within the active chat. Handles starring/unstarring messages and includes the logic for the modal to name starred templates. Displays the "Thinking..." indicator.
*   **`StarredTemplates.tsx`**: A popover component listing saved (starred) user messages that can be quickly inserted into the `ChatInput`.
*   **`StartChatPrompt.tsx`**: A placeholder shown in the chat area when a session has no chats started yet, prompting the user to begin the first chat.

### `/Sidebar`

Contains components for the left-hand sidebar within the `SessionView`.

*   **`SessionSidebar.tsx`**: The main sidebar component. It lists all chat histories associated with the current session, allows starting new chats, and provides options (rename, delete) for existing chats via dropdown menus and modals. It fetches session data via Jotai atoms and handles navigation between chats.
*   **`PastChatsList.tsx`**: (Potentially integrated into `SessionSidebar` or used separately) Displays a list of *other* chats in the session, excluding the currently active one, possibly for quick switching. *(Note: The current implementation seems to handle chat listing directly within `SessionSidebar`)*.

### `/Transcription`

Contains components related to displaying and editing the session's transcription.

*   **`Transcription.tsx`**: Displays the session transcript, broken down into paragraphs. Includes session metadata (client name, date, type, etc.) in the header and provides functionality to edit individual paragraphs (`TranscriptParagraph`). It also manages its own scroll state when used in tabs.
*   *(Potential)* **`TranscriptParagraph.tsx`**: (Likely lives in `src/components/Transcription/` but used here) A component representing a single paragraph of the transcript, allowing inline editing and saving.

### `/Modals`

Contains modal dialog components used within the `SessionView`.

*   **`EditDetailsModal.tsx`**: A dialog allowing the user to edit the core metadata of the session (Client Name, Session Name, Date, Type, Therapy). It handles form state, validation, and communication with the API/parent component (`SessionView`) upon saving.

## State Management

*   **Jotai**: Used extensively for global state management (e.g., `activeSessionAtom`, `activeChatIdAtom`, `pastSessionsAtom`, `starredMessagesAtom`) and some local UI state (e.g., `clampedSidebarWidthAtom`).
*   **React `useState`**: Used for local component state (e.g., modal visibility, input values, loading indicators within specific components).
*   **React Router**: `useParams` is used to get `sessionId` and `chatId` from the URL. `useNavigate` is used for programmatic navigation (e.g., switching chats, redirecting on error).

## Data Flow

1.  **`SessionView`** fetches the core session data, transcript, and determines the initial active chat based on URL params or the latest chat.
2.  `SessionView` passes the `session` object and `activeChatId` down to `SessionContent`.
3.  `SessionContent` routes data to `Transcription` and `ChatInterface`.
4.  **`SessionSidebar`** reads the active session from Jotai and displays the list of chats. Clicking a chat navigates via React Router, triggering `SessionView`'s effects. Starting/deleting chats updates Jotai state and potentially triggers navigation.
5.  **`ChatInterface`** uses `activeChatId` to potentially trigger message fetching (delegated back up to `SessionView`'s effects) or reads messages from Jotai (`currentChatMessagesAtom`).
6.  **`ChatInput`** sends new messages via an API call and updates the global `pastSessionsAtom` via a Jotai setter upon success.
7.  **`Transcription`** displays paragraphs from the session data. Editing a paragraph triggers a save function passed down from `SessionView`, which calls the API and updates state.
8.  **`EditDetailsModal`** receives the session, manages its form state, and calls an `onSaveSuccess` callback provided by `SessionView` after a successful API update. `SessionView` then updates its local and global state optimistically.
