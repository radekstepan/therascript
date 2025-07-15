/*
 * packages/ui/src/store/index.ts
 * Re-exports all Jotai atoms for easier access.
 */
export * from './action/closeUploadModalAtom';
export * from './action/openUploadModalAtom';
export * from './action/setSessionSortAtom';
export * from './action/setStandaloneChatSortAtom';

export * from './chat/chatErrorAtom';
export * from './chat/currentQueryAtom';
export * from './chat/toastMessageAtom';
// Remove export for standaloneSearchTermAtom
// export * from './chat/standaloneSearchTermAtom';

export * from './session/activeChatIdAtom';
export * from './session/activeSessionIdAtom';
export * from './session/sessionSortCriteriaAtom';
export * from './session/sessionSortDirectionAtom';

export * from './standaloneChatSortCriteriaAtom';
export * from './standaloneChatSortDirectionAtom';

export * from './ui/clampedSidebarWidthAtom';
export * from './ui/effectiveThemeAtom'; // This will now correctly point to the dedicated file
export * from './ui/isUploadModalOpenAtom';
export * from './ui/renderMarkdownAtom';
export * from './ui/sidebarWidthAtom';
export * from './ui/themeAtom'; // This exports themeAtom and Theme type from its dedicated file
export * from './ui/isPersistentSidebarOpenAtom'; // Added in previous step
export * from './ui/accentColorAtom'; // <-- ADDED EXPORT
export * from './ui/isSystemReadyAtom'; // <-- ADDED EXPORT

export * from './navigation/currentPageAtom'; // Added in previous step
