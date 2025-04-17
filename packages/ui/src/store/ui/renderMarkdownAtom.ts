// packages/ui/src/store/ui/renderMarkdownAtom.ts
import { atomWithStorage } from 'jotai/utils';

/**
 * Atom to control whether AI responses should be rendered as Markdown.
 * Persisted in localStorage. Defaults to true.
 */
export const renderMarkdownAtom = atomWithStorage<boolean>('ui-render-markdown', true);
