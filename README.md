# TODO

- [ ] shutdown and autostart scripts
    - https://aistudio.google.com/prompts/12ixBihqRs-Vn7qgPVNv8EzoqszjTg1Pl
    - https://grok.com/chat/d53dbfa2-fdf7-4d5c-83fb-1e900f113ae2

- [ ] make the chat paragraph icons larger, add a gap between them AND/OR move the play icon to the left of the paragraph
- [ ] fix vertical align of transcript header, items too close to the top; `align-items: flex-end`
- [ ] reduce the left and right padding on the chat/transcript section and be consistent with the chats section
- [ ] the formatting of date fields is not consistent when rendered as an `input type="date"` and text field
- [ ] show progress bar when transcribing a chat session and be able to abort the process
- [ ] if you can't find chat data, show the same message when we fail to load the session
- [ ] the `sessionSortCriteriaAtom` says it's sorting by "date", but in the UI it shows sorted by "Client"
- [ ] change the theme dropodown such that we highlight rather than show a checkmark next to the selected theme
- [ ] make sure to unload whisper when we are done transcribing
- [ ] the edit transcript modal should let you delete the whole transcript. That will delete the transcript and all chat messages. Well, it'll "archive" it so that it's hidden from the UI but it's still in the DB just in case.
- [ ] when you upload/transcribe a file, you should reset the New Session modal
- [ ] when I click to Rename Chat, the input field that opens in the modal should be focused
- [ ] toast should above modal
- [x] make sure the AI response "cursor" is less dark and is still blinking.The copy icon shouldn't show until after the whole response has been received.
- [x] starred messages don't show in the popover
- [ ] the star message icon is too small and not vertically aligned with the message itself
- [ ] think about the starred messages popover, the list/UI looks odd
- [ ] move env files to root dir
- [ ] is the token count actually accurate? the current "used" tokens, but also the tokens in the transcript. Do they update after edititing a paragraph?
- [ ] when you fail to pull a model, putting a correct link won't start the pull (clear existing pull errors)
- [ ] you should clear the input field when you send a message and be able to type your new message while the AI is responding
- [ ] issue with chats in loading state (ask Gemma about Jotai implementation)
- [ ] toast needs a bit of border else it fades with the background
- [x] starring standalone chat messages is not working at all

## Nice to have

- [ ] autocomplete client name when typing in both the create new session and editing an existing one (select dropdown with a free form input too?)
- [ ] for reasoning models, display the <think> section separately
- [ ] actually delete cached Ollama models
- [ ] when you render markdown, the output is usually a paragraph tag which means the cursor will always be on the newline.
- [ ] when a message has finished streaming we refetch the messages which causes a flash of content

## Future

- [ ] the topbar/header should have a search field. Clicking into it expands a panel that lets you search for chats or transcripts and has extra optional filters to drill down by different tags, client names, dates. Does this mean all paragraphs and chats are stored in a vector database in addition or instead of sqlite? Is that the best way to find a document through "free text"?

## Refactor

- [ ] centralize types into a separate package
- [ ] detect similar code
- [ ] 4 spaces everywhere plus autoformat on git commit
- [ ] remove unused logic
- [ ] split into smaller files
- [ ] add comments, data-attrs (takes > 10 minutes)
- [ ] reuse package dependencies
- [ ] make sure READMEs are up to date, plus add screenshots
- [ ] consistent error messages when we go offline

## Ideas

- [ ] tag emotions
- [ ] tag recurring themes
- [ ] dashboard shows a timeline of all sessions
- [ ] add insight agents? mood tracker looking for shifts in tone. Theme detector could look for metaphors client uses etc. Look for setbacks, suggest techniques. Incerase in negative self talk etc.
