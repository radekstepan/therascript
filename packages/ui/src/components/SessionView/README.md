# SessionView Component Folder Context

## Purpose

This folder contains all the React components necessary to render the detailed view for a single therapy **Session**. This view typically displays the session's transcription alongside an interactive AI chat interface allowing the user (therapist) to ask questions about the session content.

## Core Components

*   **`SessionView.tsx`**: The main container and entry point for this feature. It orchestrates data fetching (session details, transcript - via Tanstack Query), manages overall loading/error states, handles routing parameters (`sessionId`, `chatId`), manages sidebar resizing, and renders the main layout structure (Sidebar + Content). It also houses the state and logic for the `EditDetailsModal` and `LlmManagementModal`.
*   **`SessionContent.tsx`**: Responsible for the main content area's layout. It displays either a side-by-side view (Transcription + Chat) on larger screens or a tabbed view on smaller screens. It passes down necessary data and callbacks to the `ChatInterface` and `Transcription` components.

## Subfolders

### `/Chat`

Contains components related to the AI chat interface for the session.

*   **`ChatInterface.tsx`**: Manages the overall chat area, fetching chat messages (via Tanstack Query), displaying the header (`ChatPanelHeader`), the message list (`ChatMessages`), and the input field (`ChatInput`). Handles scrolling behavior and displays loading/error states for messages.
*   **`ChatPanelHeader.tsx`**: Displays information about the currently active Ollama model, its loaded status, configured context size, token usage from the last interaction, and provides a button to open the `LlmManagementModal`. Fetches Ollama status via Tanstack Query.
*   **`ChatInput.tsx`**: The text input field for sending messages to the AI. Includes functionality for using starred templates, handling message submission (via Tanstack Mutation), displaying errors, and showing loading/cancel states during AI response generation.
*   **`ChatMessages.tsx`**: Renders the list of messages (user and AI) within the active chat. Handles starring/unstarring messages (via Tanstack Mutation) and includes the logic for the modal to name starred templates. Displays the "Thinking..." indicator and streaming text updates.
*   **`StarredTemplatesList.tsx`**: (Used by `ChatInput`) A popover component listing saved (starred) user messages fetched via Tanstack Query that can be quickly inserted into the `ChatInput`.
*   **`StartChatPrompt.tsx`**: A placeholder shown in the chat area when a session has no chats started yet, prompting the user to begin the first chat.
*   **`ChatHeader.tsx`**: (Potentially less used now) Originally displayed the simple chat title; `ChatPanelHeader` is now the primary header.

### `/Sidebar`

Contains components for the left-hand sidebar within the `SessionView`.

*   **`SessionSidebar.tsx`**: The main sidebar component. It displays session information (pulled from the parent `SessionView`'s query data), lists all chat histories associated with the current session, allows starting new chats, and provides options (rename, delete) for existing chats via dropdown menus and modals (triggering Tanstack Mutations). It handles navigation between chats by updating the URL.
*   **`PastChatsList.tsx`**: (Potentially unused/integrated) Originally intended to display past chats separately.

### `/Transcription`

Contains components related to displaying and editing the session's transcription.

*   **`Transcription.tsx`**: Displays the session transcript (fetched via Tanstack Query), broken down into paragraphs. Includes session metadata in the header and provides functionality to edit individual paragraphs (`TranscriptParagraph`) triggering a Tanstack Mutation on save. Manages audio playback state and controls. Allows deleting the original audio file via a dropdown menu and confirmation modal (triggering a Tanstack Mutation).

### `/Modals`

Contains modal dialog components used within the `SessionView`.

*   **`EditDetailsModal.tsx`**: A dialog allowing the user to edit the core metadata of the session (Client Name, Session Name, Date, Type, Therapy). It handles form state, validation, and triggers a Tanstack Mutation upon saving.
*   **`LlmManagementModal.tsx`**: A dialog for managing the Ollama service. Allows viewing available/active models, setting the active model/context size, pulling new models, canceling downloads, and deleting local models. Uses Tanstack Query/Mutation extensively.

## State Management

*   **Tanstack Query (`@tanstack/react-query`)**: Used extensively for fetching, caching, and mutating server state (sessions, transcripts, chat messages, Ollama status/models). Manages loading, error, and fetching states for server data.
*   **Jotai**: Used for client-side UI state:
    *   `activeSessionIdAtom`, `activeChatIdAtom`: Track the *currently viewed* session/chat ID based on the URL.
    *   `sidebarWidthAtom`, `clampedSidebarWidthAtom`: Manage the resizable sidebar width.
    *   `toastMessageAtom`: Controls brief notification messages.
    *   `currentQueryAtom`: Holds the text currently in the chat input field.
    *   `renderMarkdownAtom`: UI preference for rendering AI responses.
*   **React `useState`**: Used for local component state (e.g., modal visibility, input values within modals, local loading indicators, audio playback state).
*   **React Router**: `useParams` is used to get `sessionId` and `chatId` from the URL. `useNavigate` is used for programmatic navigation (e.g., switching chats, redirecting on error or after deletion).

## Data Flow

1.  **`SessionView`** gets `sessionId` from URL params.
2.  It uses `useQuery` (Tanstack Query) to fetch the core session data (metadata + list of chat IDs/names).
3.  It uses `useQuery` to fetch the transcript content.
4.  It uses `useEffect` to synchronize the `activeSessionIdAtom` and `activeChatIdAtom` based on the URL parameters and the fetched session data (defaulting to the latest chat if no `chatId` is in the URL).
5.  `SessionView` passes the fetched `session` object down to `SessionSidebar` and `SessionContent`.
6.  **`SessionSidebar`** displays the chat list from the `session` prop. Clicking a chat navigates via React Router, updating URL params and triggering `SessionView`'s effects. Starting/deleting/renaming chats triggers Tanstack Mutations which update server state and invalidate relevant Tanstack Query keys (e.g., `sessionMeta`) to refetch.
7.  **`SessionContent`** passes data down to `ChatInterface` and `Transcription`.
8.  **`ChatInterface`** uses the `activeChatId` (from URL/atom) and `activeSessionId` (from `session` prop) to construct a query key (`['chat', activeSessionId, activeChatId]`) and uses `useQuery` to fetch the detailed message history for the active chat.
9.  **`ChatInput`** uses a Tanstack Mutation (`addMessageMutation`) to send new messages. On `onMutate`, it optimistically adds temporary user/AI messages to the Tanstack Query cache. On `onSuccess`, it starts processing the streaming response, updating the temporary AI message in the cache. On stream completion/error, it may invalidate the chat query.
10. **`Transcription`** displays paragraphs from the `transcriptContent` prop (fetched by `SessionView`). Editing a paragraph triggers a Tanstack Mutation (`saveParagraphMutation`) which updates the server and invalidates the transcript query key (`['transcript', sessionId]`) and potentially the session metadata key (`['sessionMeta', sessionId]`) if token counts change. Audio playback controls update local state (`isPlaying`, etc.) and interact with the HTML `<audio>` element. Deleting audio triggers a Tanstack Mutation.
11. Modals (`EditDetailsModal`, `LlmManagementModal`) manage their own internal state and use Tanstack Mutations to interact with the backend, invalidating relevant queries on success.
