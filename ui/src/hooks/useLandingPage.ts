// src/hooks/useLandingPage.ts
import { useState, useEffect, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { fetchSessions } from '../api/api';
import {
    // Import atoms from specific files or main index
    pastSessionsAtom,          // From sessionAtoms <<< CORRECTED
    sortedSessionsAtom,        // From derivedAtoms
    sessionSortCriteriaAtom,   // From sessionAtoms <<< CORRECTED
    sessionSortDirectionAtom,  // From sessionAtoms <<< CORRECTED
    setSessionSortActionAtom,  // From actionAtoms
    openUploadModalActionAtom, // From actionAtoms
    // Import types from source file
    SessionSortCriteria,       // From sessionAtoms <<< CORRECTED
    SortDirection              // From sessionAtoms <<< CORRECTED
} from '../store'; // Use main index

export function useLandingPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const setPastSessions = useSetAtom(pastSessionsAtom); // Use correct atom
    const sortedSessions = useAtomValue(sortedSessionsAtom);
    const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom); // Use correct atom
    const currentSortDirection = useAtomValue(sessionSortDirectionAtom); // Use correct atom
    const setSort = useSetAtom(setSessionSortActionAtom);
    const openUploadModal = useSetAtom(openUploadModalActionAtom);

    useEffect(() => {
        let isMounted = true;
        const loadSessions = async () => {
            setIsLoading(true); setError(null);
            try {
                const data = await fetchSessions(); if (isMounted) { setPastSessions(data); }
            } catch (err) {
                console.error("Failed to load sessions:", err); if (isMounted) { setError('Failed to load sessions.'); setPastSessions([]); }
            } finally { if (isMounted) { setIsLoading(false); } }
        };
        loadSessions();
        return () => { isMounted = false; };
    }, [setPastSessions]);

    const handleSort = useCallback((criteria: SessionSortCriteria) => { // Use correct type
        setSort(criteria);
    }, [setSort]);

    return {
        isLoading, error, sortedSessions, currentSortCriteria, currentSortDirection, handleSort, openUploadModal,
    };
}
