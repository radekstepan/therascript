import { atom } from 'jotai';
import type { Session } from '../../types'; // Assuming types is ../../

// This atom should be populated by LandingPage fetch or refresh action
export const pastSessionsAtom = atom<Session[]>([]);
