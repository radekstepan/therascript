// Purpose: Defines a Jotai atom with storage to control whether AI chat responses
//          should be rendered as Markdown or plain text.
import { atomWithStorage } from 'jotai/utils'; // Utility to persist atom state in localStorage

/**
 * Atom storing the user's preference for rendering AI responses as Markdown.
 * - `true`: Render AI responses using ReactMarkdown.
 * - `false`: Render AI responses as plain text.
 * - Persisted in localStorage under the key 'ui-render-markdown'.
 * - Defaults to `true` if no value is found in storage.
 */
export const renderMarkdownAtom = atomWithStorage<boolean>(
  'ui-render-markdown', // localStorage key
  true // Default value
);
