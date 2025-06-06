// packages/ui/src/store/navigation/currentPageAtom.ts
import { atom } from 'jotai';

// Default to '/' or your main dashboard route identifier
export const currentPageAtom = atom<string>('/');
