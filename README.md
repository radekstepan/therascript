# TODO

- [ ] make sure the preload task deletes the whole data folder
- [ ] verify/fix shutdown and autostart scripts
- [x] fix the crappy search query; multiple keywords should join on a "*" character, special characters and quotes properly escaped, multiple spaces removed
- [x] move transcripts and their paragraphs into the DB
- [x] try combining fulltext chat search with transcript search
- [ ] fix the search UI
    - be able to filter by client and/or tags
    - Escape should exit out of the UI much like clicking the "x"
    - input field should remain focused on Enter keypress
- [ ] put search query in the URL so that you can go back to your results easily
- [ ] make favoriting work again

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
- [ ] the star message icon is too small and not vertically aligned with the message itself
- [ ] move env files to root dir
- [ ] is the token count actually accurate? the current "used" tokens, but also the tokens in the transcript. Do they update after edititing a paragraph?
- [ ] when you fail to pull a model, putting a correct link won't start the pull (clear existing pull errors)
- [ ] you should clear the input field when you send a message and be able to type your new message while the AI is responding
- [ ] issue with chats in loading state (ask Gemma about Jotai implementation)
- [ ] toast needs a bit of border else it fades with the background
- [ ] sidebar chats should be sorted the same way they are sorted on the homepage; on session chats they should be by date
- [ ] messaging in mock mode should "connect" the mock ollama model (it works even without, but it is important to update the UI just like "real" mode would)

## Nice to have

- [ ] autocomplete client name when typing in both the create new session and editing an existing one (select dropdown with a free form input too?)
- [ ] for reasoning models, display the <think> section separately
- [ ] actually delete cached Ollama models
- [ ] when you render markdown, the output is usually a paragraph tag which means the cursor will always be on the newline.
- [ ] when a message has finished streaming we refetch the messages which causes a flash of content
- [ ] clicking on a search result should scroll to the paragraph/message in the UI
- [ ] be able to put "weights" on the search results so that a text appearing in a title is weighted more heavily

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
- [ ] Enter keypress means main action, Escape keypress means exit out of a UI (modal)

## Ideas

- [ ] tag emotions
- [ ] tag recurring themes
- [ ] dashboard shows a timeline of all sessions
- [ ] add insight agents? mood tracker looking for shifts in tone. Theme detector could look for metaphors client uses etc. Look for setbacks, suggest techniques. Incerase in negative self talk etc.
