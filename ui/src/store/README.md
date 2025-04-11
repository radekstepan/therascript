# Application State Management (Jotai Atoms)

This folder contains the core state management logic for the application, implemented using the [Jotai](https://jotai.org/) library. Jotai is an atomic state management library for React, meaning state is built up from small, independent pieces called atoms. Each atom is now located in its own file within categorized subdirectories.

**Purpose:** To provide a centralized, predictable, and efficient way to manage global application state, including session data, chat interactions, UI preferences, and actions that modify this state.

**Target Audience (for this README):** Primarily intended for an LLM to quickly understand the structure, purpose, and key concepts of the state management layer.

## Folder Structure

The state is organized into logical units (subdirectories) based on the type of state being managed. Each exported atom resides in its own file within these directories:

*   **`action/`**: Contains atoms that encapsulate actions or mutations on the state. These often involve asynchronous operations (like API calls) and update other state atoms by calling `set` on them.
    *   *(e.g., `addChatMessageAtom.ts`, `refreshSessionsAtom.ts`, `openUploadModalAtom.ts`)*
*   **`chat/`**: Contains atoms related specifically to the *current* chat interaction state.
    *   *(e.g., `currentQueryAtom.ts`, `isChattingAtom.ts`, `currentChatMessagesAtom.ts`)*
*   **`session/`**: Holds the core data atoms related to user sessions and chats (list of sessions, active IDs, derived active objects, sorting logic).
    *   *(e.g., `pastSessionsAtom.ts`, `activeSessionIdAtom.ts`, `activeSessionAtom.ts`, `sortedSessionsAtom.ts`)*
    *   Note: Some files also export related Types (e.g., `SessionSortCriteria` from `sessionSortCriteriaAtom.ts`).
*   **`ui/`**: Manages state related to the user interface.
    *   *(e.g., `themeAtom.ts`, `sidebarWidthAtom.ts`, `isUploadModalOpenAtom.ts`)*
    *   Note: Some files also export related Types or Constants (e.g., `Theme` from `themeAtom.ts`, width constants from `sidebarWidthAtom.ts`).
*   **`index.ts`**: A barrel file that re-exports all atoms (and associated types/constants) from their individual files in the subdirectories. This allows for convenient importing elsewhere in the application (e.g., `import { pastSessionsAtom, themeAtom } from '@/store';`).
*   **`README.md`**: This file.

## Key Concepts (Jotai)

*   **Atom:** The smallest unit of state (e.g., `activeSessionIdAtom` in `session/activeSessionIdAtom.ts`).
*   **Derived Atom:** An atom whose value is computed based on one or more other atoms using the `get` function within its definition (e.g., `activeSessionAtom` in `session/activeSessionAtom.ts` depends on `pastSessionsAtom` and `activeSessionIdAtom`). They recalculate automatically when dependencies change.
*   **Write-Only Atom:** An atom defined with `null` as the read value and a write function `(get, set, update) => ...`. Used purely to trigger actions (e.g., `openUploadModalAtom` in `action/openUploadModalAtom.ts`).
*   **Read/Write Atom:** An atom with both a read function `(get) => ...` (often deriving state) and a write function `(get, set, update) => ...` (for updating state or performing actions). `clampedSidebarWidthAtom` in `ui/clampedSidebarWidthAtom.ts` is an example.
*   **`atomWithStorage`:** A utility to create atoms whose values are automatically persisted to `localStorage` or `sessionStorage`.

## Usage Notes for LLM

*   **Modularity:** Each atom is self-contained in its file, importing only the specific dependencies (other atoms, types, utils, API functions) it needs.
*   **Dependencies:** Trace dependencies by looking at the `import` statements and the `get(...)` calls within each atom's definition. Relative paths like `../session/pastSessionsAtom` indicate dependencies between atoms in different categories.
*   **Entry Point:** Use `index.ts` to see the complete list of exported state atoms and related entities available from this module.
*   **Data Source:** `session/pastSessionsAtom.ts` holds the "source of truth" atom for session and chat data structures.
*   **State Modification:** Atoms in the `action/` directory are the primary mechanism for orchestrating state changes, often interacting with external APIs and then using `set` to update atoms in `session/`, `chat/`, or `ui/`.
*   **Types:** Pay attention to the types (`Session`, `ChatSession`, `ChatMessage`, etc.) imported from the main `types` directory (likely `../../types` relative to atom files) and any types defined locally within atom files (like `Theme`, `SessionSortCriteria`).
