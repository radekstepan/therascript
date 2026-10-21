---
'@therascript/api': patch
'@therascript/db': patch
'@therascript/services': patch
'@therascript/worker': patch
---

# Production-readiness fixes: model lifecycle, thinking budgets, transcription & indexing

## Model loading & lifecycle

- **Auto-load the model before chat streaming.** `addSessionChatMessage` and
  `addStandaloneChatMessage` now call `ensureModelLoaded` with the configured
  context size immediately before `streamChatResponse`, so sending a message
  after an unload (chat STOP, transcription VRAM handoff) no longer fails or
  falls back to LM Studio's default 4K auto-load.
- **STOP no longer wipes a remote LM Studio URL.** `POST /api/llm/unload` now
  accepts an optional `{ resetBaseUrl }` body defaulting to `false` instead of
  unconditionally resetting `app_settings.llm_base_url` to local.
- **Status polling no longer clobbers a pending model switch.** `checkModelStatus`
  skips syncing transient LM Studio state back into `app_settings` while a
  model load is in flight, so the UI's 2s `/api/llm/status` poll can't overwrite
  the just-requested Model B with the still-unloading Model A.
- **Worker model-URL tracking & GPU offload.** `loadLlmModelForWorker` tracks the
  worker's last active base URL across calls so remote→remote and remote→local
  switches evict the stale model, and now honors `jobRecord.num_gpu_layers`
  (`offload_kv_cache_to_gpu`) like the API loader. The load-time-only nature of
  `StreamLlmChatOptions.contextSize` is documented on the type and its dead
  pass-throughs removed from the analysis worker.

## Thinking budgets & `<think>` isolation

- **Resilient streaming `<think>` parser.** `streamLlmChatDetailed` replaces
  per-chunk `includes('<think>')` checks with a stateful, case-insensitive tag
  parser that buffers partial tags across SSE chunk boundaries (including
  1-char-at-a-time streams), so split tags can no longer leak reasoning into
  visible output or swallow entire answers into `<think>`.
- **`thinkingBudget: -1` ("Unrestricted") no longer starves completions.**
  The analysis worker resolves `-1`/unset budgets to the 40% thinking cap via
  the new `resolveEffectiveThinkingBudget` helper in both Map and Reduce phases,
  so reasoning models can't spend 100% of `max_tokens` inside `<think>` and
  return empty summaries.
- **`enable_thinking` aligned with `thinkingBudget: 0`.** The client defaults
  `chat_template_kwargs.enable_thinking` to `false` when thinking is disabled
  (unless explicitly set); analysis and worker callers derive it from the
  effective budget instead of hardcoding `true`. Short-prompt title generation
  disables thinking and strips `<think>` via `extractVisibleAnswer`.
- **Thinking-only chat responses are surfaced.** Session and standalone chat now
  detect turns with zero visible answer tokens and append/stream a fallback
  notice explaining the token budget was exhausted while reasoning.

## Transcription, indexing & chat helpers

- **Whisper inactivity timeout actually fires.** `pollWhisperStatus` only resets
  `lastActivityTime` on genuine progress/status change, so hung jobs with an
  unchanging 200 OK status stop polling forever.
- **`speaker` preserved in Elasticsearch.** Re-indexing on session-metadata
  updates and paragraph edits now includes the `speaker` field, matching the
  initial transcription indexing shape.
- **Chat history no longer corrupted when speakers are hidden.** The over-broad
  `([A-Z][A-Za-z]+)` speaker-stripping regex is replaced with a shared
  `stripSpeakerLabelsFromHistory()` helper restricted to line-start
  `SPEAKER_\d+` labels, used identically by prompt construction and token
  estimation — prose like `Summary:` and `Note:` survives.
- **Token counts include the speaker prefix.** `transcriptTokenCount` (worker and
  paragraph-edit paths) counts the formatted `speaker: text` line, closing a
  1,500–2,500 token undercount on long sessions.
- **Truncation hardened.** `truncateTranscriptToTokenBudget` bounds the tail loop
  against head overlap, returns marker-free output when nothing is dropped, and
  falls back to slicing oversized monologue paragraphs instead of returning an
  empty transcript.
- **User-edited system prompts survive restarts.** `seedSystemTemplates` is now
  insert-only and no longer overwrites `prompt_templates` customizations made in
  the UI on every boot.
- **Transcript moved to the system prompt for KV-cache reuse.** Session chat
  injects `CONTEXT TRANSCRIPT` into the stable system-prompt prefix instead of
  the latest user message, so follow-up turns reuse LM Studio's prefix cache
  instead of re-prefilling the transcript every message.
- **Dead code removed.** The broken, unmounted `finalizeSessionHandler` and
  mistyped `getStructuredTranscriptionResult` are deleted.
