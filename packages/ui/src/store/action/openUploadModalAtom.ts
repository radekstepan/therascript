import { atom } from 'jotai';
import {
    isUploadModalOpenAtom,
} from '..';

// TODO what should be the type of these?
export const openUploadModalAtom = atom(null, (_get, set) => {
    // set(transcriptionErrorAtom, ''); // Error state managed by mutation
    set(isUploadModalOpenAtom, true);
});
