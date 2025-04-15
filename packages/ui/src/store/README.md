# Application State Management (Jotai Atoms)

This folder contains the client-side state management logic for the application, implemented using the [Jotai](https://jotai.org/) library. Jotai is used here primarily for **UI state** and other client-only state concerns.

**Server state management** (fetching, caching, mutations related to backend data like sessions, chats, transcripts) is handled by **Tanstack Query (`@tanstack/react-query`)**, which is configured in `src/index.tsx` and used via hooks (`useQuery`, `useMutation`) directly within components.

**Purpose (of Jotai in this project):** To provide a centralized, predictable, and efficient way to manage global **UI state** (like theme, sidebar width, modal visibility) and potentially transient client state (like the current chat input value).

**Target Audience (for this README):** Primarily intended for an LLM to quickly understand the structure, purpose, and key concepts of the **Jotai-managed state** within the application.

## Folder Structure

The state is organized into logical units (subdirectories) based on the type of state being managed. Each exported atom resides in its own file within these directories:

*   **`action/`**: Contains atoms that encapsulate actions or mutations *on UI state*.
    *   *(e.g., `openUploadModalAtom.ts`, `closeUploadModalAtom.ts`, `setSessionSortAtom.ts`)*
*   **`chat/`**: Contains atoms related specifically to the *current* chat interaction state *that isn't server data*.
    *   *(e.g., `currentQueryAtom.ts`, `toastMessageAtom.ts`, `chatErrorAtom.ts` [for local errors])*
*   **`session/`**: Holds state atoms related to the *currently selected* session/chat identifiers and sorting preferences (which influence how Tanstack Query data is displayed).
    *   *(e.g., `activeSessionIdAtom.ts`, `activeChatIdAtom.ts`, `sessionSortCriteriaAtom.ts`, `sessionSortDirectionAtom.ts`)*
    *   Note: Some files also export related Types (e.g., `SessionSortCriteria` from `sessionSortCriteriaAtom.ts`).
*   **`ui/`**: Manages state related to the user interface appearance and behavior.
    *   *(e.g., `themeAtom.ts`, `sidebarWidthAtom.ts`, `isUploadModalOpenAtom.ts`)*
    *   Note: Some files also export related Types or Constants (e.g., `Theme` from `themeAtom.ts`, width constants from `sidebarWidthAtom.ts`).
*   **`index.ts`**: A barrel file that re-exports all atoms (and associated types/constants) from their individual files in the subdirectories. This allows for convenient importing elsewhere in the application (e.g., `import { activeSessionIdAtom, themeAtom } from '@/store';`).
*   **`README.md`**: This file.

## Key Concepts (Jotai)

*   **Atom:** The smallest unit of state (e.g., `activeSessionIdAtom` in `session/activeSessionIdAtom.ts`).
*   **Derived Atom:** An atom whose value is computed based on one or more other atoms using the `get` function within its definition (e.g., `effectiveThemeAtom` in `ui/effectiveThemeAtom.ts`). They recalculate automatically when dependencies change.
*   **Write-Only Atom:** An atom defined with `null` as the read value and a write function `(get, set, update) => ...`. Used purely to trigger actions (e.g., `openUploadModalAtom` in `action/openUploadModalAtom.ts`).
*   **Read/Write Atom:** An atom with both a read function `(get) => ...` (often deriving state) and a write function `(get, set, update) => ...` (for updating state or performing actions). `clampedSidebarWidthAtom` in `ui/clampedSidebarWidthAtom.ts` is an example.
*   **`atomWithStorage`:** A utility to create atoms whose values are automatically persisted to `localStorage` or `sessionStorage`.

## Usage Notes for LLM

*   **Focus:** Jotai atoms here primarily manage client-side state. Look for Tanstack Query hooks (`useQuery`, `useMutation`) in components for server data fetching and caching.
*   **Modularity:** Each Jotai atom remains self-contained in its file.
*   **Dependencies:** Trace dependencies by looking at the `import` statements and the `get(...)` calls within each atom's definition.
*   **Entry Point:** Use `index.ts` to see the complete list of exported state atoms and related entities available from this module.
*   **Data Source:** Server data (sessions, transcripts, chat messages) is managed by Tanstack Query's cache, not by atoms like `pastSessionsAtom` (which has been removed).
*   **State Modification:** Atoms in the `action/` directory modify UI state. Server state modifications are triggered by calling `mutate` from `useMutation` hooks in components.
*   **Types:** Pay attention to the types (`Session`, `ChatSession`, `ChatMessage`, etc.) imported from the main `types` directory (likely `../../types` relative to atom files) and any types defined locally within atom files (like `Theme`, `SessionSortCriteria`).
