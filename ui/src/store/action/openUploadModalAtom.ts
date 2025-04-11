import { atom } from 'jotai';
import {
    isUploadModalOpenAtom,
    transcriptionErrorAtom
} from '..'; // Import from the main store index

export const openUploadModalAtom = atom(null, (get, set) => {
    set(transcriptionErrorAtom, '');
    set(isUploadModalOpenAtom, true);
});
