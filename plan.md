Your plan is directionally correct, but I’d tighten a few things before handing it to a coding LLM:

- **Normalize/validate base URLs** instead of comparing raw strings or checking for `"localhost"`.
- **Treat `undefined` vs `null` differently**: `undefined` = don’t change current base URL; `null` = reset to local/default.
- **Update repository readers/mappers too**, not just `createJob`, otherwise `llm_base_url` may not appear in worker job records.
- **Expose `isRemoteBaseUrl` from `/status`** so the UI does not guess remote/local using brittle substring checks.
- **Make every new service signature accept `string | null | undefined` consistently.**
- **Ensure workers do not start/restart local LM Studio/runtime when the persisted job URL is remote.**
- **Validate the remote URL server-side** to avoid malformed requests and accidental SSRF-style behavior.

Below is an updated copy-paste prompt you can use.

---

# Prompt for the AI Coding Model

## Objective

Implement a dynamic **Local / Remote LLM** toggle for Therascript.

The system currently hardcodes the LM Studio / llama.cpp base URL. We need to allow the user to connect to a remote LM Studio-compatible instance via the UI, store the active routing choice in backend application state, persist the chosen base URL on analysis jobs, and ensure background MapReduce jobs use the same network target that was active when the job was created.

## Important implementation rules

1. **Normalize all LLM base URLs**:
   - Trim whitespace.
   - Require `http://` or `https://`.
   - Remove trailing slashes.
   - Treat empty string as `null`.

2. **Use these semantics everywhere**:
   - `undefined` means “do not change the currently configured base URL.”
   - `null` means “reset to local/default base URL.”
   - A non-empty string means “use this explicit base URL.”

3. **Do not determine remote/local by checking whether the URL contains `localhost`.**
   - Compare the normalized URL against the normalized configured default base URL.
   - Expose `isRemoteBaseUrl` from the backend status endpoint so the UI can rely on backend state.

4. **Update all TypeScript interfaces, Zod schemas, repository mappers, query results, and worker job schemas** touched by `analysis_jobs`.

5. **If the target URL is remote, do not start, stop, or restart the local runtime daemon.**
   - Only call the remote HTTP API.

---

## Step 1: Database Schema & Migration v17

**Files to modify:**

- `packages/db/src/sqliteService.ts`
- `packages/data/src/repositories/analysisRepository.ts`

### `sqliteService.ts`

1. Increment `LATEST_SCHEMA_VERSION` to `17`.

2. Add a migration block for `currentVersion < 17`.

3. Add the nullable column:

```sql
ALTER TABLE analysis_jobs ADD COLUMN llm_base_url TEXT NULL;
```

4. Make the migration safe if this codebase already has helper utilities for checking existing columns. Prefer:

```sql
PRAGMA table_info(analysis_jobs);
```

and only run the `ALTER TABLE` if `llm_base_url` does not already exist.

5. Update `currentVersion` and `PRAGMA user_version = 17`.

### `analysisRepository.ts`

1. Update `createJob` to accept the new persisted base URL:

```ts
llmBaseUrl: string | null = null
```

2. Update the `INSERT` SQL to include:

```sql
llm_base_url
```

3. Pass `llmBaseUrl` into the `run()` call.

4. Update **all job SELECT statements, row mappers, return types, and helper functions** so `llm_base_url` is loaded from the database.

5. Existing/old jobs should continue to work with `llm_base_url === null`.

---

## Step 2: Domain Schema Updates

**Files to modify:**

- `packages/domain/src/schemas/db/analysisJob.ts`
- `packages/domain/src/index.ts`
- `packages/ui/src/types.ts`

### `analysisJob.ts`

Add this field to the Zod schema:

```ts
llm_base_url: z.string().nullable(),
```

If test fixtures or legacy parsing require it, use a compatible form such as:

```ts
llm_base_url: z.string().nullable().default(null),
```

but only if the existing schema style supports defaults.

### `packages/domain/src/index.ts`

Add to the `AnalysisJob` interface:

```ts
llm_base_url: string | null;
```

### `packages/ui/src/types.ts`

Add to the `AnalysisJob` interface:

```ts
llm_base_url: string | null;
```

Update the `LlmStatus` interface to include:

```ts
activeBaseUrl?: string;
defaultBaseUrl?: string;
isRemoteBaseUrl?: boolean;
```

---

## Step 3: Backend Active LLM Base URL State

**File to modify:**

- `packages/api/src/services/activeModelService.ts`

Add process-level state for the configured override:

```ts
let configuredBaseUrl: string | null = null;
```

Add helper functions similar to these:

```ts
export const normalizeLlmBaseUrl = (value?: string | null): string | null => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid LLM base URL: ${trimmed}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`LLM base URL must use http or https: ${trimmed}`);
  }

  return parsed.toString().replace(/\/+$/, '');
};

export const getDefaultBaseUrl = (): string => {
  const normalized = normalizeLlmBaseUrl(config.llm.baseURL);

  if (!normalized) {
    throw new Error('config.llm.baseURL is not configured');
  }

  return normalized;
};

export const getActiveBaseUrl = (): string => {
  return configuredBaseUrl || getDefaultBaseUrl();
};

export const isRemoteLlmBaseUrl = (baseUrl?: string | null): boolean => {
  const target = normalizeLlmBaseUrl(baseUrl) || getActiveBaseUrl();
  return target !== getDefaultBaseUrl();
};

export const getConfiguredBaseUrlOverride = (): string | null => {
  return configuredBaseUrl;
};
```

Update `setActiveModelAndContextAndParams`:

1. Add a new optional parameter:

```ts
newBaseUrl?: string | null
```

2. Important behavior:

```ts
if (newBaseUrl !== undefined) {
  configuredBaseUrl = normalizeLlmBaseUrl(newBaseUrl);
}
```

This ensures:

- `undefined` does not change the current base URL.
- `null` resets to default/local.
- A string sets a remote/custom URL.

3. Continue updating active model, context, and params as before.

---

## Step 4: Refactor LLM Service for Dynamic URLs

**File to modify:**

- `packages/api/src/services/llamaCppService.ts`

Import the helpers from `activeModelService.ts`:

```ts
import {
  getActiveBaseUrl,
  isRemoteLlmBaseUrl,
  normalizeLlmBaseUrl,
} from './activeModelService';
```

Add a local resolver helper if useful:

```ts
const resolveLlmBaseUrl = (baseUrlOverride?: string | null): string => {
  return normalizeLlmBaseUrl(baseUrlOverride) || getActiveBaseUrl();
};
```

### Update `listModels`

1. Add parameter:

```ts
baseUrlOverride?: string | null
```

2. Use:

```ts
const targetUrl = resolveLlmBaseUrl(baseUrlOverride);
```

3. Fetch from `targetUrl`, not `config.llm.baseURL`.

### Update `loadLlmModel`

1. Add parameter:

```ts
baseUrlOverride?: string | null
```

2. Resolve:

```ts
const targetUrl = resolveLlmBaseUrl(baseUrlOverride);
const isRemote = isRemoteLlmBaseUrl(targetUrl);
```

3. Only call `runtime.restartWithModel()` when `!isRemote`.

4. Use `targetUrl` for all Axios calls, including:

```ts
/api/v1/models/unload
/api/v1/models/load
```

5. Do not spawn, restart, or manage a local daemon when `targetUrl` is remote.

### Update `unloadActiveModel`

1. Use:

```ts
const targetUrl = getActiveBaseUrl();
```

2. Use `targetUrl` for Axios requests.

3. Only call:

```ts
runtime.stop()
```

when:

```ts
!isRemoteLlmBaseUrl(targetUrl)
```

### Update `checkModelStatus`

Use `getActiveBaseUrl()` for Axios requests.

### Update `ensureLlmReady`

1. Add parameter:

```ts
baseUrlOverride?: string | null
```

2. Resolve:

```ts
const targetUrl = resolveLlmBaseUrl(baseUrlOverride);
```

3. If remote:

```ts
if (isRemoteLlmBaseUrl(targetUrl)) {
  return isLlmApiResponsive(targetUrl);
}
```

4. If local, preserve existing behavior:

```ts
await runtime.ensureReady();
```

then verify responsiveness.

5. If `isLlmApiResponsive` currently hardcodes the base URL, update it to accept `baseUrl`.

### Update `fetchVramUsage`

1. Add parameter:

```ts
baseUrlOverride?: string | null
```

2. Resolve:

```ts
const targetUrl = resolveLlmBaseUrl(baseUrlOverride);
```

3. If remote, skip native/local LM Studio VRAM estimation:

```ts
if (isRemoteLlmBaseUrl(targetUrl)) {
  return estimateVramUsage(...);
}
```

4. If local, preserve the existing native estimation behavior.

### Update all call sites

After changing these signatures, update every TypeScript call site so compilation succeeds.

---

## Step 5: Update API Routes

**File to modify:**

- `packages/api/src/routes/llmRoutes.ts`

Import:

```ts
import {
  getActiveBaseUrl,
  getDefaultBaseUrl,
  isRemoteLlmBaseUrl,
  normalizeLlmBaseUrl,
  setActiveModelAndContextAndParams,
} from '../services/activeModelService';
```

Adjust imports to match existing project paths.

### `POST /set-model`

1. Update `SetModelBodySchema` to include:

```ts
baseUrl: t.Optional(t.Union([t.String(), t.Null()]))
```

or equivalent for the project’s schema library.

2. Extract:

```ts
const { baseUrl } = body;
```

3. Validate/normalize if `baseUrl` is provided:

```ts
const normalizedBaseUrl =
  baseUrl === undefined ? undefined : normalizeLlmBaseUrl(baseUrl);
```

4. Pass `normalizedBaseUrl` to:

```ts
setActiveModelAndContextAndParams(...)
```

and:

```ts
loadLlmModel(...)
```

5. If URL validation fails, return a `400` response with a clear error message.

### `GET /available-models`

1. Add query schema validation for:

```ts
baseUrl?: string
```

2. Extract:

```ts
const baseUrl = query.baseUrl;
```

3. Validate/normalize if provided.

4. Call:

```ts
listModels(normalizedBaseUrl)
```

5. If invalid, return `400`.

### `GET /status`

Append the following fields to the response:

```ts
activeBaseUrl: getActiveBaseUrl(),
defaultBaseUrl: getDefaultBaseUrl(),
isRemoteBaseUrl: isRemoteLlmBaseUrl(getActiveBaseUrl()),
```

---

## Step 6: Route Jobs to the Correct Network

**Files to modify:**

- `packages/api/src/api/analysisHandler.ts`
- `packages/worker/src/jobs/analysisProcessor.ts`
- `packages/api/src/api/sessionChatHandler.ts`
- `packages/api/src/api/standaloneChatHandler.ts`

### `analysisHandler.ts`

When creating an analysis job, pass the active base URL into the new repository argument:

```ts
analysisRepository.createJob(
  ...existingArgs,
  getActiveBaseUrl()
);
```

Import `getActiveBaseUrl`.

This intentionally stores the resolved active URL on the job so the worker uses the same LLM network target even if the user later changes the toggle.

### `analysisProcessor.ts`

1. Ensure the job record type/schema includes:

```ts
llm_base_url: string | null;
```

2. Resolve the base URL for the job:

```ts
const jobLlmBaseUrl = jobRecord.llm_base_url || config.llm.baseURL;
```

3. Update `loadLlmModelForWorker` to accept:

```ts
baseUrl: string
```

and use that instead of `config.llm.baseURL`.

4. If `loadLlmModelForWorker` currently starts/restarts local runtime processes, skip that behavior when `baseUrl` is remote. Use the same normalized comparison logic as the API service, or duplicate a small safe helper in the worker package if imports would create an inappropriate dependency.

5. When calling `loadLlmModelForWorker`, pass:

```ts
jobLlmBaseUrl
```

6. When calling `streamLlmChatDetailed` for both Map and Reduce phases, pass:

```ts
llamaCppBaseUrl: jobLlmBaseUrl
```

inside the options object.

7. If `streamLlmChatDetailed` does not currently honor `llamaCppBaseUrl`, update that lower-level service/client too.

### `sessionChatHandler.ts`

When calling `streamChatResponse`, pass:

```ts
llamaCppBaseUrl: getActiveBaseUrl()
```

inside the options object.

### `standaloneChatHandler.ts`

When calling `streamChatResponse`, pass:

```ts
llamaCppBaseUrl: getActiveBaseUrl()
```

inside the options object.

---

## Step 7: Frontend API Client

**File to modify:**

- `packages/ui/src/api/llm.ts`

### `fetchAvailableModels`

Update signature:

```ts
fetchAvailableModels(baseUrl?: string | null)
```

When `baseUrl` is provided, send it as a query parameter using `URLSearchParams`.

Example:

```ts
const params = new URLSearchParams();

if (baseUrl?.trim()) {
  params.set('baseUrl', baseUrl.trim());
}

const query = params.toString();
const url = query ? `/api/llm/available-models?${query}` : `/api/llm/available-models`;
```

Use the project’s existing API path conventions.

### `setLlmModel`

Update signature to include:

```ts
baseUrl?: string | null
```

Include `baseUrl` in the JSON payload.

For local/default mode, send:

```ts
baseUrl: null
```

For remote mode, send the trimmed remote URL.

---

## Step 8: UI Modal Toggle

**File to modify:**

- `packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx`

### State

Add:

```ts
const [isRemote, setIsRemote] = useState(false);
const [remoteUrl, setRemoteUrl] = useState('');
```

Add or reuse a debounce helper:

```ts
const debouncedRemoteUrl = useDebounce(remoteUrl, 500);
```

If no debounce hook exists, implement one locally or use the project’s existing utility.

### Initialize modal state

In the `useEffect` that initializes the modal on open:

1. Prefer backend-provided status fields:

```ts
if (llmStatus?.isRemoteBaseUrl && llmStatus.activeBaseUrl) {
  setIsRemote(true);
  setRemoteUrl(llmStatus.activeBaseUrl);
} else {
  setIsRemote(false);
  setRemoteUrl('');
}
```

2. Do not rely on checking whether the URL contains `localhost`.

### Add Local / Remote control

Add a segmented control, toggle group, radio group, or equivalent above the model select:

- `Local Machine`
- `Remote Machine`

When switching to local:

```ts
setIsRemote(false);
```

When switching to remote:

```ts
setIsRemote(true);
```

### Remote URL input

If `isRemote` is true, show a text field:

```tsx
<TextField
  label="Remote LM Studio URL"
  placeholder="http://192.168.1.100:1234"
  value={remoteUrl}
  onChange={(e) => setRemoteUrl(e.target.value)}
/>
```

Use the project’s actual UI components.

### Validate URL on frontend

Add a small helper:

```ts
const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};
```

Derive:

```ts
const normalizedRemoteUrl = remoteUrl.trim();
const canFetchRemoteModels = !isRemote || isValidHttpUrl(debouncedRemoteUrl);
```

### Update available models query

Update the `useQuery` for available models:

```ts
const modelsBaseUrl = isRemote ? debouncedRemoteUrl.trim() : null;

const availableModelsQuery = useQuery({
  queryKey: ['availableLlmModels', isRemote ? modelsBaseUrl : 'local'],
  queryFn: () => fetchAvailableModels(modelsBaseUrl),
  enabled: isOpen && (!isRemote || isValidHttpUrl(modelsBaseUrl ?? '')),
});
```

Make sure:

- Typing in the remote URL is debounced.
- Invalid partial URLs do not spam the API.
- Switching back to local fetches local models again.
- Query key includes the selected base URL.

### Save behavior

In `handleSave`, pass:

```ts
baseUrl: isRemote ? remoteUrl.trim() : null
```

to `setModelMutation.mutate()`.

Also prevent save if remote mode is selected and the URL is invalid.

---

## Step 9: UI Headers

**Files to modify:**

- `packages/ui/src/components/SessionView/Chat/ChatPanelHeader.tsx`
- `packages/ui/src/components/StandaloneChatView/StandaloneChatHeader.tsx`

When rendering the active model name, check:

```ts
llmStatus?.isRemoteBaseUrl
```

If true, display a small badge next to the model name:

```tsx
<Badge>🌐 Remote</Badge>
```

Use the project’s actual badge component/styling.

Do not use URL substring checks such as `includes('localhost')`.

---

## Step 10: Error Handling and UX

1. If remote model fetching fails, show a useful message such as:

```txt
Could not connect to remote LLM server. Check the URL and ensure the LM Studio server is running.
```

2. If setting/loading the remote model fails, keep the modal open and show the backend error.

3. Make sure local mode still behaves exactly as before.

4. Make sure the app can recover by switching back to local mode and saving.

---

## Step 11: Acceptance Criteria

The implementation is complete when all of the following are true:

1. Existing local LLM behavior still works without configuration changes.

2. `/api/llm/status` returns:

```ts
activeBaseUrl
defaultBaseUrl
isRemoteBaseUrl
```

3. The model selection modal can switch between Local and Remote.

4. Remote URL input is debounced before calling `fetchAvailableModels`.

5. `GET /available-models?baseUrl=...` fetches models from the provided remote base URL.

6. `POST /set-model` with:

```json
{
  "baseUrl": null
}
```

resets to local/default.

7. `POST /set-model` with a remote URL sets the active base URL and loads the model through that URL.

8. Chat streaming uses the currently active base URL.

9. Analysis jobs persist `llm_base_url` when created.

10. Worker MapReduce analysis uses `jobRecord.llm_base_url || config.llm.baseURL`.

11. A job created while remote mode is active continues using the stored remote URL even if the user later switches the UI back to local.

12. Remote jobs do not start, stop, or restart the local runtime daemon.

13. TypeScript compiles cleanly.

14. Database migration from schema version 16 to 17 succeeds.

15. Existing jobs with `llm_base_url = null` still process using the default local base URL.
