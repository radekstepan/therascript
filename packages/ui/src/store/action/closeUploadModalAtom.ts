import { atom } from 'jotai';
import {
  isUploadModalOpenAtom,
  // toastMessageAtom // Toast logic might change with mutations
} from '..';

export const closeUploadModalAtom = atom(null, (get, set) => {
  // Logic preventing close during transcription is now handled within the modal's useMutation state
  // and the onOpenChange handler binding in UploadModal.tsx.
  set(isUploadModalOpenAtom, false);
  // set(transcriptionErrorAtom, ''); // Error state managed by mutation
});
