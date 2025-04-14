import { atom } from 'jotai';
import type { Session } from '../../types';

// This atom should be populated by LandingPage fetch or refresh action
export const pastSessionsAtom = atom<Session[]>([]);
