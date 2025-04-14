import { atom } from 'jotai';
import { pastSessionsAtom } from './pastSessionsAtom';
import { activeSessionIdAtom } from './activeSessionIdAtom';
import type { Session } from '../../types';

export const activeSessionAtom = atom<Session | null>((get) => {
    const sessions = get(pastSessionsAtom);
    const id = get(activeSessionIdAtom);
    const foundSession = id !== null ? sessions.find((s) => s.id === id) ?? null : null;
    return foundSession;
});
