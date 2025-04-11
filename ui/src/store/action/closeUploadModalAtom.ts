import { atom } from 'jotai';
import {
  isUploadModalOpenAtom,
  isTranscribingAtom,
  transcriptionErrorAtom,
  toastMessageAtom
} from '..'; // Import from the main store index

export const closeUploadModalAtom = atom(null, (get, set) => {
    if (!get(isTranscribingAtom)) {
        set(isUploadModalOpenAtom, false);
        set(transcriptionErrorAtom, '');
    } else {
        set(toastMessageAtom, "Please wait for the transcription to finish before closing.");
    }
});
