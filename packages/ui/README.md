# Therascript Frontend UI (`packages/ui`)

This package contains the React-based frontend application for Therascript. It provides the user interface for interacting with the backend API (`packages/api`).

## Purpose

*   Display lists of therapy sessions and standalone chats.
*   Allow users to upload new session audio files and associated metadata.
*   Present the detailed view for a session, including:
    *   Session metadata display and editing.
    *   Transcription viewing and paragraph-level editing.
    *   AI chat interface for asking questions about the transcript.
*   Provide an interface for standalone AI chat sessions.
*   Implement a search interface to query across transcripts and messages.
*   Offer modals for managing Ollama models (viewing status, pulling, deleting, setting active model) and Docker container status.
*   Allow users to configure UI settings (e.g., theme, Markdown rendering).
*   Provide system controls (e.g., triggering PC shutdown via the API).

## Key Technologies

*   **Framework/Library:** React 19
*   **Language:** TypeScript
*   **UI Components:** Radix UI Themes, Radix UI Primitives, Radix UI Icons
*   **Styling:** Tailwind CSS (via PostCSS)
*   **State Management:**
    *   **Server State:** Tanstack Query (`@tanstack/react-query`) for fetching, caching, and mutating backend data.
    *   **UI State:** Jotai for global UI state (theme, modal visibility, sidebar width, etc.).
*   **Routing:** React Router DOM
*   **Build Tool:** Webpack
*   **API Client:** Axios

## Structure Overview

*   **`public/`:** Contains the base `index.html` file and static assets (like favicons).
*   **`src/`:** Contains the main application source code.
    *   **`api/`:** Typed functions for making requests to the backend API endpoints using Axios and Fetch (for streaming). Organised by feature (chat, session, ollama, etc.).
    *   **`components/`:** Reusable React components, organized by feature/view (e.g., `LandingPage`, `SessionView`, `StandaloneChatView`, `UploadModal`, `User`, `Search`).
    *   **`hooks/`:** Custom React hooks (e.g., `useMessageStream` for handling Server-Sent Events).
    *   **`store/`:** Jotai atom definitions for global UI state management. See `src/store/README.md` for details.
    *   **`styles/`:** Global CSS styles (`global.css`).
    *   **`App.tsx`:** Root application component, sets up routing, theme, and global toast provider.
    *   **`index.tsx`:** Entry point, renders the React application into the DOM, configures Tanstack Query client.
    *   **`constants.ts`:** Application-wide constants (e.g., session types, colors).
    *   **`helpers.ts`:** Utility functions (e.g., date formatting, debounce).
    *   **`types.ts`:** TypeScript type definitions for API responses and UI state.
    *   **`utils.ts`:** General utility functions (e.g., `cn` for class names).
*   **Configuration Files:** `webpack.config.js`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig.json`.

## Running the UI

*   **Development Mode (via root `yarn dev`):**
    *   The root `run-dev.js` script starts the UI dev server using `yarn dev:ui`.
    *   `yarn dev:ui`: Runs `webpack serve --mode development`.
    *   Includes Hot Module Replacement (HMR).
    *   Typically accessed at `http://localhost:3002`.
    ```bash
    # Run from project root
    yarn dev
    ```
*   **Development with Mock API (via root `yarn dev:mock`):**
    *   Starts the UI dev server alongside the API running in mock mode.
    ```bash
    # Run from project root
    yarn dev:mock
    ```
*   **Building for Production:**
    *   Run `yarn build:ui` from the root directory.
    *   This uses `webpack --mode production` to create optimized static assets in the `packages/ui/dist` folder. These assets would typically be served by a static file server (like Nginx or Caddy) or hosted on a platform like Vercel or Netlify in a real deployment.
