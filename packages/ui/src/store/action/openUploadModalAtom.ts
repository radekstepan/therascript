import { atom } from 'jotai';
import {
    isUploadModalOpenAtom,
    transcriptionErrorAtom
} from '..';

// TODO what should be the type of these?
export const openUploadModalAtom = atom(null, (_get, set) => {
    set(transcriptionErrorAtom, '');
    set(isUploadModalOpenAtom, true);
});
