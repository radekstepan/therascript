// src/store/sessionAtoms.ts
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { Session } from '../types';

// --- Types ---
export type SessionSortCriteria = 'sessionName' | 'clientName' | 'sessionType' | 'therapy' | 'date' | 'id';
export type SortDirection = 'asc' | 'desc';

// --- Base Atoms ---
export const pastSessionsAtom = atom<Session[]>([]); // Holds all fetched session data
export const activeSessionIdAtom = atom<number | null>(null); // ID of the currently viewed session

// --- Sorting State ---
export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>('session-sort-criteria', 'date');
export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');
