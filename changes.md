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