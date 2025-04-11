import { atom } from 'jotai';
import {
    isTranscribingAtom,
    transcriptionErrorAtom,
    pastSessionsAtom
} from '..'; // Import from the main store index
import { uploadSession } from '../../api/api'; // Assuming api is ../../
import type { SessionMetadata } from '../../types'; // Assuming types is ../../

export const handleStartTranscriptionAtom = atom<null, [{ file: File; metadata: SessionMetadata }], Promise<void>>(
    null,
    async (get, set, { file, metadata }) => {
        set(isTranscribingAtom, true);
        set(transcriptionErrorAtom, '');
        try {
            const newSession = await uploadSession(file, metadata); // Upload returns full session
            // Add the new session to the beginning of the list
            set(pastSessionsAtom, (prev) => [newSession, ...prev]);
            // Optionally navigate to the new session? This might be better handled in the component calling this.
        } catch (err) {
            console.error("Upload/Transcription failed:", err);
            set(transcriptionErrorAtom, 'Failed to upload and transcribe session.');
        } finally {
            set(isTranscribingAtom, false);
        }
    }
);
