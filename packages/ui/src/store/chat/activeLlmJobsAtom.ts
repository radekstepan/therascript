import { atom } from 'jotai';

export interface ActiveLlmJob {
  id: number;
  chatId: number;
  sessionId: number | null;
  isStandalone: boolean;
  promptPreview: string;
  startedAt: number;
  status: 'responding' | 'canceling';
  controller?: AbortController;
}

export const activeLlmJobsAtom = atom<ActiveLlmJob[]>([]);
