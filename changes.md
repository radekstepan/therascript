To make the application unload the model from memory when you click "STOP" during message generation, we'll hook into the stream cancellation events in both chat handlers (`sessionChatHandler.ts` and `standaloneChatHandler.ts`). 

Just like the graceful shutdown process in `server.ts` uses `unloadActiveModel()`, we can trigger the exact same function when the `AbortController` fires on a client disconnect/cancellation.

Here are the changes to implement this:

### 1. Update Session Chat Handler

**File: `packages/api/src/api/sessionChatHandler.ts`**

Update the import to include `unloadActiveModel`:

```typescript
<<<<
import { streamChatResponse } from '../services/llamaCppService.js';
====
import { streamChatResponse, unloadActiveModel } from '../services/llamaCppService.js';
>>>>
```

Next, update the `AbortController` setup and the `ReadableStream`'s `cancel` method to trigger the unload:

```typescript
<<<<
    // Dedicated abort controller for the LLM fetch connection.
    // request.signal in Elysia/Bun does NOT fire on SSE client disconnect —
    // only this controller, which we abort manually on write failure, will stop
    // the underlying fetch to LM Studio and interrupt generation.
    const llmAbortController = new AbortController();
    request.signal?.addEventListener(
      'abort',
      () => llmAbortController.abort(),
      { once: true }
    );

    const llmStream = await streamChatResponse(
====
    // Dedicated abort controller for the LLM fetch connection.
    // request.signal in Elysia/Bun does NOT fire on SSE client disconnect —
    // only this controller, which we abort manually on write failure, will stop
    // the underlying fetch to LM Studio and interrupt generation.
    const llmAbortController = new AbortController();
    
    let modelUnloaded = false;
    const triggerUnload = () => {
      if (modelUnloaded) return;
      modelUnloaded = true;
      unloadActiveModel()
        .then(() => console.log(`[API SSE ${chatData.id}] Active model unloaded due to stream cancellation.`))
        .catch(err => console.warn(`[API SSE ${chatData.id}] Error unloading model on cancel:`, err));
    };

    request.signal?.addEventListener(
      'abort',
      () => {
        llmAbortController.abort();
        triggerUnload();
      },
      { once: true }
    );

    const llmStream = await streamChatResponse(
>>>>
```

Then, update the `cancel` callback inside the `ReadableStream` block:

```typescript
<<<<
    // ReadableStream with a cancel callback — Bun calls cancel() when the HTTP
    // client closes the SSE connection. This is the only reliable disconnect hook.
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        sseController = controller;
      },
      cancel() {
        console.log(
          `[API SSE ${chatData.id}] Client disconnected — aborting LLM generation`
        );
        sseStreamClosed = true;
        llmAbortController.abort();
      },
    });
====
    // ReadableStream with a cancel callback — Bun calls cancel() when the HTTP
    // client closes the SSE connection. This is the only reliable disconnect hook.
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        sseController = controller;
      },
      cancel() {
        console.log(
          `[API SSE ${chatData.id}] Client disconnected — aborting LLM generation`
        );
        sseStreamClosed = true;
        llmAbortController.abort();
        triggerUnload();
      },
    });
>>>>
```

### 2. Update Standalone Chat Handler

**File: `packages/api/src/api/standaloneChatHandler.ts`**

Do the same updates for the standalone handler. Update the import:

```typescript
<<<<
import { streamChatResponse } from '../services/llamaCppService.js';
====
import { streamChatResponse, unloadActiveModel } from '../services/llamaCppService.js';
>>>>
```

And update the stream connection and cancellation lifecycle logic:

```typescript
<<<<
    // Dedicated abort controller for the LLM fetch connection.
    // request.signal in Elysia/Bun does NOT fire on SSE client disconnect —
    // only this controller, which we abort manually on write failure, will stop
    // the underlying fetch to LM Studio and interrupt generation.
    const llmAbortController = new AbortController();
    request.signal?.addEventListener(
      'abort',
      () => llmAbortController.abort(),
      { once: true }
    );

    const llmStream = await streamChatResponse(
====
    // Dedicated abort controller for the LLM fetch connection.
    // request.signal in Elysia/Bun does NOT fire on SSE client disconnect —
    // only this controller, which we abort manually on write failure, will stop
    // the underlying fetch to LM Studio and interrupt generation.
    const llmAbortController = new AbortController();

    let modelUnloaded = false;
    const triggerUnload = () => {
      if (modelUnloaded) return;
      modelUnloaded = true;
      unloadActiveModel()
        .then(() => console.log(`[API SSE ${chatData.id}] Active model unloaded due to stream cancellation.`))
        .catch(err => console.warn(`[API SSE ${chatData.id}] Error unloading model on cancel:`, err));
    };

    request.signal?.addEventListener(
      'abort',
      () => {
        llmAbortController.abort();
        triggerUnload();
      },
      { once: true }
    );

    const llmStream = await streamChatResponse(
>>>>
```

Then update the `cancel` callback:

```typescript
<<<<
    // ReadableStream with a cancel callback — Bun calls cancel() when the HTTP
    // client closes the SSE connection. This is the only reliable disconnect hook.
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        sseController = controller;
      },
      cancel() {
        console.log(
          `[API SSE ${chatData.id}] Client disconnected — aborting LLM generation`
        );
        sseStreamClosed = true;
        llmAbortController.abort();
      },
    });
====
    // ReadableStream with a cancel callback — Bun calls cancel() when the HTTP
    // client closes the SSE connection. This is the only reliable disconnect hook.
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        sseController = controller;
      },
      cancel() {
        console.log(
          `[API SSE ${chatData.id}] Client disconnected — aborting LLM generation`
        );
        sseStreamClosed = true;
        llmAbortController.abort();
        triggerUnload();
      },
    });
>>>>
```

With these updates, whenever a user clicks **STOP** in the UI, the HTTP connection is aborted. The API hooks into the drop (either through the `cancel` callback or the `.addEventListener('abort', ...)` hook depending on timing/framework bindings), cleanly kills the LLM request, and then unloads the active model from LM Studio to free up your machine's resources immediately.

---

## Outcome (added after implementation)

The original plan targeted server-side hooks (`request.signal` abort listener +
`ReadableStream.cancel()` callback in the API handlers). It did not work
end-to-end because of a bug in Elysia 1.2.25's web-standard adapter:

- **File:** `node_modules/elysia/dist/adapter/web-standard/handler.mjs`
- **Line:** 262
- **Bug:** `if (request?.signal && !request?.signal?.aborted) response.cancel();`
  — the condition is inverted. The abort listener never cancels the response,
  so the server's `ReadableStream.cancel()` callback is never invoked on SSE
  client disconnect. The abort signal is already aborted when the listener
  runs, so `!request?.signal?.aborted` is always false and `response.cancel()`
  is never called.

**Working fix:** The UI's `handleCancelStream` (`packages/ui/src/components/SessionView/Chat/ChatInterface.tsx`) calls `unloadLlmModel()` 500ms after aborting the browser fetch. The 500ms matches the test-script pattern (wait for the LM Studio compute thread to release the model lock after the upstream TCP socket closes).

The server-side hooks added during the initial implementation (`request.signal` listener, `ReadableStream.cancel()` callback, `processStream` finally safety net, and the `triggerUnload` retry-with-backoff helper) are kept as a server-side safety net. They will start firing if Elysia is ever upgraded to a fixed version, with no code changes required.

See `docs/DATA_FLOWS.md` §6 for the full data flow and `docs/ARCHITECTURE.md` for the SSE-handling caveat.

---

## Remote LLM API token

A single, globally-stored, optional API token (`Authorization: Bearer …`)
is automatically attached to every request targeting a non-local LLM base
URL. One value applies to all remote URLs; the user sets or clears it once
via the "Configure AI Model" or "Analyze Multiple Sessions" dialog.

**Touch list**

- `packages/db/src/sqliteService.ts` — V19 migration adds
  `app_settings.llm_api_token TEXT NULL`.
- `packages/data/src/repositories/appSettingsRepository.ts` — `get/update`
  SQL plumb the new column.
- `packages/domain/src/schemas/db/appSettings.ts` — Zod schema gains
  `llm_api_token: z.string().nullable()`.
- `packages/api/src/services/activeModelService.ts` — new
  `getActiveApiToken`, `setActiveApiToken`, `hasActiveApiToken`; the
  existing `setActiveModelAndContextAndParams` gets an optional
  `newApiToken` (9th) positional parameter; `clearModelAndContext()`
  preserves the token (it is not model-derived).
- `packages/api/src/services/llamaCppService.ts` — single new gating
  function `authHeadersFor(baseUrl)` returns
  `{ Authorization: 'Bearer <token>' }` only when `isRemoteLlmBaseUrl`
  is true. Every axios call site (listModels, loadLlmModel,
  unloadActiveModel, unloadModelAtUrl, checkModelStatus,
  startDownloadModelJob, isLlmApiResponsive, …) routes through it. The
  streaming path (`streamChatResponse`) uses a sibling
  `resolveLlmApiToken` helper to forward the token to
  `streamLlmChatDetailed` via a new `llmApiToken` option.
- `packages/api/src/routes/llmRoutes.ts` — new `POST /api/llm/api-token`
  body schema (`{ token: string | null }`); `/api/llm/status` response
  now exposes `hasRemoteApiToken: boolean`. The token value is **never**
  returned to the UI.
- `packages/services/src/llamaCppClient.ts` — new `llmApiToken` option
  on `StreamLlmChatOptions`; the `fetch` to `/v1/chat/completions`
  adds `Authorization: Bearer <token>` when a non-empty token is
  supplied. The client is URL-agnostic; the caller is responsible for
  gating on "is this remote?".
- `packages/worker/src/jobs/analysisProcessor.ts` — new
  `loadLlmApiTokenForWorker` (reads `app_settings` via
  `appSettingsRepository`) + worker-local `authHeadersForWorker`. Every
  `fetch` to the LM Studio API (enumerate, load, unload) and both
  `streamLlmChatDetailed` calls (map + reduce phases) route through
  them. Re-reads the token on every call so rotation takes effect
  without restarting the worker.
- `packages/ui/src/types.ts` — `LlmStatus` gains `hasRemoteApiToken`
  (presence boolean only).
- `packages/ui/src/api/llm.ts` — new `setLlmApiToken(token)` wrapper.
- `packages/ui/src/components/Shared/LlmEndpointModelPicker.tsx` — new
  "API Token (optional)" field rendered under the Remote URL, gated
  on `isRemote`. Placeholder text switches between
  "Token is set — type a new value to replace" and
  "Enter API token (optional)" based on the presence boolean. A
  "Clear" icon button empties the field.
- `packages/ui/src/components/Shared/LlmSettingsForm.tsx` — plumbs
  `apiToken` through `LlmSettingsState` and forwards
  `hasRemoteApiToken` from `llmStatus` to the picker.
- `packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx`
  & `packages/ui/src/components/Analysis/CreateAnalysisJobModal.tsx` —
  initialize `apiToken: ''` on form open; on save, fire
  `setLlmApiToken(...)` only when the user actually changed the field
  (typed non-empty value → set; empty value + token currently saved →
  clear; empty value + no token saved → no-op). The token value is
  never persisted to `localStorage`.
- `packages/ui/src/mocks/state.ts` and `handlers/llm.ts` — MSW
  handler for `POST /api/llm/api-token`; `/api/llm/status` returns
  `hasRemoteApiToken: !!mockLlmApiToken`.

**Test coverage** (asserts "passed and only to remote"):

- `packages/services/src/llamaCppClient.test.ts` — Authorization
  header is attached when `llmApiToken` is set, omitted otherwise;
  client is URL-agnostic (forwards whatever the caller supplies).
- `packages/api/src/services/llamaCppService.test.ts` — Bearer header
  is attached to listModels, loadLlmModel (enumerate + load), unloadActiveModel
  (enumerate + unload), unloadModelAtUrl (enumerate + unload),
  checkModelStatus (enumerate) when remote + token; **omitted on a
  local URL even when a token is configured**. `streamChatResponse`
  forwards `llmApiToken: <token>` to `streamLlmChatDetailed` when
  remote + token; forwards `llmApiToken: null` when local or when no
  token is configured.
- `packages/worker/src/jobs/analysisProcessor.test.ts` — Bearer header
  on `loadLlmModelForWorker` and `unloadModelAtUrlForWorker` only when
  remote + token; omitted on local. Token is re-read from
  `app_settings` on every call (rotation works without restart).
- `packages/api/src/services/activeModelService.test.ts` — set/get
  round-trip, trim semantics, idempotency, preservation through
  `clearModelAndContext`, and `setActiveModelAndContextAndParams`
  `newApiToken` semantics.
- `packages/ui/src/components/Shared/LlmSettingsForm.test.tsx` — token
  controls render only when `isRemote`; presence label switches based
  on `llmStatus.hasRemoteApiToken`; setting/clearing the token writes
  through to `state.apiToken`.

**Out of scope**

- The token is never sent to the local default base URL. The
  `isRemoteLlmBaseUrl(url)` gate is the single source of truth.
- The token is never stored in `localStorage` on the UI (it is
  sensitive). It lives in form state only and round-trips to the
  backend on save.
- The token is never returned in any API response. Only its presence
  boolean is.
- No per-URL or per-endpoint token scoping. One global value, by
  design.

---

## Remote LLM API token — auto-clear removal + e2e coverage

Follow-up to the feature above. Two issues caught during the e2e
spec build:

1. **The save handler was wiping the token.** Both
   `SelectActiveModelModal.handleSave` and
   `CreateAnalysisJobModal.handleSubmit` had a branch that called
   `setApiToken(null)` when the typed token field was empty but a
   token was already saved — i.e. re-opening the dialog and clicking
   Save & Load Model without typing a new value would clear the
   credential. The "Clear" icon button in `LlmEndpointModelPicker`
   is the dedicated way to clear; the save handler no longer fires
   `setApiToken` at all when the field is empty. The only way to
   set/replace the token is to type a new value; the only way to
   clear it is the Clear button (or the same Clear semantics in
   `CreateAnalysisJobModal`).
2. **No e2e spec for the flow.** Added
   `packages/ui/tests/e2e/remote-llm-api-token.spec.ts`, which:

   - Opens the chat, defensively unloads any model a previous spec
     in the same worker may have left loaded, opens the Configure
     AI Model dialog, switches to Remote Machine, types the URL +
     an API token, picks a remote model, and clicks Save & Load
     Model.
   - Intercepts `POST /api/llm/api-token` via `page.on('request')`
     and asserts the body carried the typed token.
   - Sends a chat message the same way as the local flow (same
     `[data-testid="chat-input"]` + Enter pattern) and asserts the
     AI bubble + the context progress bar render.
   - Re-opens the dialog, asserts the token input placeholder reads
     `"Token is set — type a new value to replace"` (the presence
     boolean survived), and asserts no second
     `POST /api/llm/api-token` has fired (the empty re-save is a
     no-op).
   - Sends a second chat message and reads `/api/llm/status` to
     assert `hasRemoteApiToken === true` (proves the server-side
     token is still there for subsequent requests).
   - Replaces the token with a new value (unload, type the new
     token, save) and asserts the new value is what got sent —
     never `null`, never the old value.

**Mock infrastructure changes** (needed for the spec to round-trip
the URL + token through the MSW handlers):

- `packages/ui/src/mocks/state.ts` — new `mockActiveBaseUrl` +
  `setMockActiveBaseUrl`. The `e2eMockSeed` (called from
  `POST /api/__e2e/reset`) now also resets
  `mockActiveModel = ''`, `mockModelLoaded = false`, and
  `mockActiveBaseUrl = null`, so specs that open the Configure
  AI Model dialog start from a known-good baseline.
- `packages/ui/src/mocks/handlers/llm.ts` — `POST /api/llm/set-model`
  now persists the `baseUrl` payload into
  `mockActiveBaseUrl` (so a subsequent re-open of the dialog
  sees `isRemoteBaseUrl: true` and renders the remote URL + token
  fields). The `POST /api/llm/unload` handler now flips
  `mockModelLoaded = false` + `mockActiveModel = ''` so the
  in-dialog "Unload" callout disappears and the picker becomes
  editable. The `GET /api/llm/status` handler now computes
  `isRemoteBaseUrl` from the persisted
  `mockActiveBaseUrl` (mirroring
  `packages/api/src/services/activeModelService.ts:isRemoteLlmBaseUrl`).

**Tests**

- All 333 unit tests pass (`yarn vitest run`).
- All 31 e2e tests pass (`yarn e2e`) including the new
  `remote-llm-api-token.spec.ts`.