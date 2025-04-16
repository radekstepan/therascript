# TODO

- [x] switch to a monorepo
- [x] why do we fetch sessions 2x on initial page load? Is it because React@18 and `useEffect` firing 2x? Do we need to switch to Tanstack Query and cache the data there? Would it make Jotai smaller too?
- [x] double flash of "chats" section on initial load (might be fixed by the above)
- [ ] when you upload a new session, create an initial chat behind the scenes for it and redirect the page to this chat details page
- [ ] when you create a new chat, redirect the UI to that chat page
- [x] chats rename/delete hamburger icon should be inside the chat name wrapper (leave enough padding on the right of the name for the icon to show)
- [ ] make the chat paragraph icons larger, add a gap between them AND/OR move the play icon to the left of the paragraph
- [ ] fix vertical align of transcript header, items too close to the top; `align-items: flex-end`
- [x] edit session details date is not editable
- [ ] reduce the left and right padding on the chat/transcript section and be consistent with the chats section
- [x] starred messages popover shows below the chats sidebar; should show to the right too
- [ ] in the sessions sidebar the session link active onclick outline is being cutoff (top and left)
- [x] add icons on all modals/dialogs, right now only the edit transcript paragraph has them
- [x] on smaller screens make sure you can still choose a different chat/create a new one; maybe move the chats sidebar into a separate tab much like Chat and Transcript
- [ ] when you send a message and there's an error from the API, the message could still be saved, so keep showing it in the UI
- [ ] the star message icon is too small and not vertically aligned with the message itself
- [ ] think about the starred messages popover, the list/UI looks odd
- [ ] the formatting of date fields is not consistent when rendered as an `input type="date"` and text field
- [ ] show progress bar when transcribing a chat session and be able to abort the process
- [ ] starred messages don't show in the popover
- [ ] if you can't find chat data, show the same message when we fail to load the session
- [ ] the `sessionSortCriteriaAtom` says it's sorting by "date", but in the UI it shows sorted by "Client"
- [x] unload LM toast shows 2x
- [ ] change the theme dropodown such that we highlight rather than show a checkmark next to the selected theme
- [ ] make sure to unload whisper when we are done transcribing
- [ ] add hamburger icon in the session history table for each row to be able to edit the details there as well much like on the session page
- [ ] the edit transcript modal should let you delete the whole transcript. That will delete the transcript and all chat messages. Well, it'll "archive" it so that it's hidden from the UI but it's still in the DB just in case.
- [x] if I run yarn dev then use llama3 and a tiny whisper model; have a configuration for "prod" as well that I can easily change by modifying the config. Should live in the root dir as an env file I think
- [ ] show the user message in the UI immediately after sending it
- [ ] when sorting by date in session history, make sure we use a full datetime
- [x] md5 on the DB init script file and check on api start that we use the latest version of the db or throw an error
- [ ] the transcript has no spaces between sentences
- [x] the status API should be called every time the dropdown menu to check if a model is loaded is opened, the response should not be cached
- [ ] show how large the context is in tokens and warn if context is too large
- [ ] when you upload/transcribe a file, you should reset the New Session modal

## Nice to have

- [ ] autocomplete client name when typing in both the create new session and editing an existing one (select dropdown with a free form input too?)

## Future

- [ ] the homepage should have a chats section that has "free text" chats, displayed much like Session History. It lets you chat with the model without having a transcript to refer to
- [ ] the topbar/header should have a search field. Clicking into it expands a panel that lets you search for chats or transcripts and has extra optional filters to drill down by different tags, client names, dates. Does this mean all paragraphs and chats are stored in a vector database in addition or instead of sqlite? Is that the best way to find a document through "free text"?

## Refactor

- [ ] 4 spaces everywhere plus autoformat on save
- [ ] remove unused logic
- [ ] add comments, data-attrs (takes > 10 minutes)
- [ ] reuse package dependencies

## Ideas

- [ ] tag emotions
- [ ] tag recurring themes
- [ ] dashboard shows a timeline of all sessions
- [ ] add insight agents? mood tracker looking for shifts in tone. Theme detector could look for metaphors client uses etc. Look for setbacks, suggest techniques. Incerase in negative self talk etc.
