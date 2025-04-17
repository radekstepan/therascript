# TODO

- [x] when you upload a new session, create an initial chat behind the scenes for it and redirect the page to this chat details page
- [x] when you create a new chat, redirect the UI to that chat page
- [ ] make the chat paragraph icons larger, add a gap between them AND/OR move the play icon to the left of the paragraph
- [ ] fix vertical align of transcript header, items too close to the top; `align-items: flex-end`
- [ ] reduce the left and right padding on the chat/transcript section and be consistent with the chats section
- [ ] in the sessions sidebar the session link active onclick outline is being cutoff (top and left)
- [ ] when you send a message and there's an error from the API, the message could still be saved, so keep showing it in the UI
- [ ] the star message icon is too small and not vertically aligned with the message itself
- [ ] think about the starred messages popover, the list/UI looks odd
- [ ] the formatting of date fields is not consistent when rendered as an `input type="date"` and text field
- [ ] show progress bar when transcribing a chat session and be able to abort the process
- [ ] starred messages don't show in the popover
- [ ] if you can't find chat data, show the same message when we fail to load the session
- [ ] the `sessionSortCriteriaAtom` says it's sorting by "date", but in the UI it shows sorted by "Client"
- [ ] change the theme dropodown such that we highlight rather than show a checkmark next to the selected theme
- [ ] make sure to unload whisper when we are done transcribing
- [ ] the edit transcript modal should let you delete the whole transcript. That will delete the transcript and all chat messages. Well, it'll "archive" it so that it's hidden from the UI but it's still in the DB just in case.
- [ ] when you upload/transcribe a file, you should reset the New Session modal
- [ ] when I click to Rename Chat, the input field that opens in the modal should be focused
- [x] fix not downloading larger ollama models
- [ ] make sure the AI response "cursor" is less dark and is still blinking.The copy icon shouldn't show until after the whole response has been received.

## Nice to have

- [ ] autocomplete client name when typing in both the create new session and editing an existing one (select dropdown with a free form input too?)
- [ ] for reasoning models, display the <think> section separately

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
