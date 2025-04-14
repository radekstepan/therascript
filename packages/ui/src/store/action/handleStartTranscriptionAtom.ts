import { atom } from 'jotai';
import {
    isTranscribingAtom,
    transcriptionErrorAtom,
    pastSessionsAtom
} from '..';
import { uploadSession } from '../../api/api';
import type { SessionMetadata } from '../../types';

export const handleStartTranscriptionAtom = atom<null, [{ file: File; metadata: SessionMetadata }], Promise<void>>(
    null,
    async (get, set, { file, metadata }) => {
        set(isTranscribingAtom, true);
        set(transcriptionErrorAtom, '');
        try {
            const newSession = await uploadSession(file, metadata); // Upload returns full session
            // Add the new session to the beginning of the list
            set(pastSessionsAtom, (prev) => [newSession, ...prev]);
        } catch (err) {
            console.error("Upload/Transcription failed:", err);
            set(transcriptionErrorAtom, 'Failed to upload and transcribe session.');
        } finally {
            set(isTranscribingAtom, false);
        }
    }
);
