# Model Parameters Refactoring Plan

## Overview

This plan outlines the refactoring of model parameter management in the Therascript application. The goal is to consolidate model configuration (model selection, context size, system prompt, and sampling parameters) into a single, unified configuration interface, while removing redundant and unused controls from the session-based Run Configuration sidebar.

## Current State

### Run Configuration Sidebar (`packages/ui/src/components/Layout/RunConfigSidebar.tsx`)

- **Model Parameters Section:** Contains sliders for Temperature, Top-P, and Repeat Penalty
  - **Status:** Controls exist but are **not wired** to the backend/Ollama requests
  - **Storage:** Persisted via Jotai atoms with localStorage (`temperatureAtom`, `topPAtom`, `repeatPenaltyAtom`)
- **System Prompt Section:** Textarea for per-session system prompt override
  - **Status:** Functional, allows overriding default system prompt per session
  - **Storage:** Per-session override stored in `systemPromptOverrideAtom`

### Model Configuration Modal (`packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx`)

- **Current Functionality:** Select active model and configure context size
- **Endpoint:** `POST /api/ollama/set-model`
- **Parameters:** modelName (required), contextSize (optional)

### Backend Services

- **`streamLlmChat` (`packages/services/src/ollamaClient.ts`):** Currently accepts `model`, `contextSize`, `abortSignal`, `timeoutMs`, `stopTokens`, `ollamaBaseUrl`
- **`activeModelService` (`packages/api/src/services/activeModelService.ts`):** Stores `activeModelName` and `configuredContextSize` in memory via `setActiveModelAndContext()`
- **`ollamaRoutes` (`packages/api/src/routes/ollamaRoutes.ts`):** API endpoints including `/set-model`, `/status`, `/unload`, `/available-models`, `/pull-model`, `/delete-model`

## Parameter Behavior Analysis

| Parameter                | Scope       | Ollama Behavior                      | Current Implementation |
| ------------------------ | ----------- | ------------------------------------ | ---------------------- |
| System Prompt            | Per Request | Sent with every chat request         | Per-session override   |
| Temperature              | Per Request | Controls randomness (sampling)       | UI-only, not used      |
| Top-P                    | Per Request | Controls token sampling diversity    | UI-only, not used      |
| Repeat Penalty           | Per Request | Penalizes repetition in output       | UI-only, not used      |
| Context Size (`num_ctx`) | Per Load    | Requires model reload to take effect | Global, via modal      |
| Model Selection          | Per Load    | Requires model load                  | Global, via modal      |

**Conclusion:** All of these parameters define the "active model configuration" and should be managed together in the Model Configuration modal. The session-based sidebar should focus exclusively on session metadata.

## Proposed Implementation

### Phase 1: Backend Enhancements

#### 1.1 Extend `streamLlmChat` Options

**File:** `packages/services/src/ollamaClient.ts`

```typescript
export interface StreamLlmChatOptions {
  model?: string;
  contextSize?: number;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  stopTokens?: string[];
  ollamaBaseUrl?: string;
  temperature?: number; // NEW
  topP?: number; // NEW
  repeatPenalty?: number; // NEW
}
```

**Implementation:** Pass these parameters to the `ollama.chat()` options:

```typescript
const ollamaOptions: any = {
  stop: stopTokens,
};

if (contextSize !== null && contextSize !== undefined) {
  ollamaOptions.num_ctx = contextSize;
}

if (temperature !== undefined) {
  ollamaOptions.temperature = temperature;
}

if (topP !== undefined) {
  ollamaOptions.top_p = topP;
}

if (repeatPenalty !== undefined) {
  ollamaOptions.repeat_penalty = repeatPenalty;
}
```

#### 1.2 Update `activeModelService`

**File:** `packages/api/src/services/activeModelService.ts`

Add global state for the new parameters:

```typescript
let activeModelName: string = config.ollama.model;
let configuredContextSize: number | null = null;
let configuredTemperature: number = 0.7; // NEW
let configuredTopP: number = 0.9; // NEW
let configuredRepeatPenalty: number = 1.1; // NEW (matches current UI default)
```

Update setters/getters to include new parameters:

```typescript
export const getConfiguredTemperature = (): number => configuredTemperature;
export const getConfiguredTopP = (): number => configuredTopP;
export const getConfiguredRepeatPenalty = (): number => configuredRepeatPenalty;

export const setActiveModelAndContextAndParams = (
  newModelName: string,
  newContextSize?: number | null,
  newTemperature?: number,
  newTopP?: number,
  newRepeatPenalty?: number
): void => {
  // Validation and update logic for all parameters
};
```

#### 1.3 Update API Endpoint

**File:** `packages/api/src/routes/ollamaRoutes.ts`

Extend `SetModelBodySchema` and `/set-model` endpoint:

```typescript
const SetModelBodySchema = t.Object({
  modelName: t.String({ minLength: 1 }),
  contextSize: t.Optional(t.Union([t.Number(), t.Null()])),
  temperature: t.Optional(t.Number()),
  topP: t.Optional(t.Number()),
  repeatPenalty: t.Optional(t.Number()),
});
```

Update handler to pass parameters through service layer:

```typescript
app.post('/set-model', async ({ body, set }) => {
  const { modelName, contextSize, temperature, topP, repeatPenalty } = body;
  setActiveModelAndContextAndParams(
    modelName,
    contextSize,
    temperature,
    topP,
    repeatPenalty
  );
  await loadOllamaModel(modelName);
  // ...
});
```

#### 1.4 Wire Parameters in `ollamaService.ts`

**File:** `packages/api/src/services/ollamaService.ts`

(Note: The codebase uses a single `ollamaService.ts` file, not separate `.real.ts` and `.mock.ts` files.)

Update `streamChatResponse` to retrieve and pass the global parameters:

```typescript
const temperature = options?.temperature ?? getConfiguredTemperature();
const topP = options?.topP ?? getConfiguredTopP();
const repeatPenalty = options?.repeatPenalty ?? getConfiguredRepeatPenalty();

const streamGenerator = streamLlmChat(messages, {
  model: modelToUse,
  contextSize: contextSize ?? undefined,
  temperature,
  topP,
  repeatPenalty,
  abortSignal: options?.signal,
  ollamaBaseUrl: config.ollama.baseURL,
});
```

### Phase 2: UI Refactoring

#### 2.1 Remove Controls from Run Configuration Sidebar

**File:** `packages/ui/src/components/Layout/RunConfigSidebar.tsx`

**Remove:**

- `Model Parameters` section (lines 218-301)
- `System Prompt` section (lines 303-357)
- Related imports from `runConfigSidebarAtom`: `temperatureAtom`, `topPAtom`, `repeatPenaltyAtom`, `systemPromptOverrideAtom`
- Related state in `SectionState` interface: `modelParams`, `systemPrompt`
- Related handlers: `handleSystemPromptChange`

**Result:** Sidebar will only contain "Session Metadata" section when a session is active.

#### 2.2 Remove Atoms

**File:** `packages/ui/src/store/ui/runConfigSidebarAtom.ts`

**Remove:**

- `temperatureAtom`
- `topPAtom`
- `repeatPenaltyAtom`
- `systemPromptOverrideAtom`

**Note:** These were only used in the sidebar, no longer needed.

#### 2.3 Enhance Model Configuration Modal

**File:** `packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx`

**Add Sections:**

##### System Prompt Section

```tsx
<Box>
  <Text as="div" size="2" mb="1" weight="medium">
    System Prompt
  </Text>
  <TextField.Root asChild>
    <textarea
      value={systemPromptInput}
      onChange={(e) => setSystemPromptInput(e.target.value)}
      placeholder="Enter default system prompt..."
      rows={4}
    />
  </TextField.Root>
</Box>
```

##### Model Parameters Section

```tsx
<Box className="space-y-4">
  {/* Temperature */}
  <Box>
    <Flex align="center" justify="between" mb="2">
      <Text size="1">Temperature</Text>
      <Badge variant="outline" size="1">
        {temperature.toFixed(1)}
      </Badge>
    </Flex>
    <Slider
      value={[temperature]}
      onValueChange={([value]) => setTemperature(value)}
      min={0}
      max={2}
      step={0.1}
    />
  </Box>

  {/* Top-P */}
  <Box>
    <Flex align="center" justify="between" mb="2">
      <Text size="1">Top-P</Text>
      <Badge variant="outline" size="1">
        {topP.toFixed(2)}
      </Badge>
    </Flex>
    <Slider
      value={[topP]}
      onValueChange={([value]) => setTopP(value)}
      min={0}
      max={1}
      step={0.05}
    />
  </Box>

  {/* Repeat Penalty */}
  <Box>
    <Flex align="center" justify="between" mb="2">
      <Text size="1">Repeat Penalty</Text>
      <Badge variant="outline" size="1">
        {repeatPenalty.toFixed(1)}
      </Badge>
    </Flex>
    <Slider
      value={[repeatPenalty]}
      onValueChange={([value]) => setRepeatPenalty(value)}
      min={0.5}
      max={2}
      step={0.1}
    />
  </Box>
</Box>
```

**State Management:**

```typescript
const [systemPromptInput, setSystemPromptInput] = useState('');
const [temperature, setTemperature] = useState(0.7);
const [topP, setTopP] = useState(0.9);
const [repeatPenalty, setRepeatPenalty] = useState(1.1);

// Initialize from API response when modal opens
useEffect(() => {
  if (isOpen) {
    // Fetch current config from backend or use defaults
    setTemperature(currentConfig?.temperature ?? 0.7);
    setTopP(currentConfig?.topP ?? 0.9);
    setRepeatPenalty(currentConfig?.repeatPenalty ?? 1.0);
    setSystemPromptInput(currentConfig?.systemPrompt ?? '');
  }
}, [isOpen, currentConfig]);
```

**Mutation Update:**

```typescript
const setModelMutation = useMutation({
  mutationFn: (variables: {
    modelName: string;
    contextSize?: number | null;
    temperature?: number;
    topP?: number;
    repeatPenalty?: number;
  }) =>
    setOllamaModel(
      variables.modelName,
      variables.contextSize,
      variables.temperature,
      variables.topP,
      variables.repeatPenalty
    ),
  // ...
});

const handleSave = () => {
  setModelMutation.mutate({
    modelName: selectedModel,
    contextSize: contextSizeInput ? parseInt(contextSizeInput, 10) : null,
    temperature,
    topP,
    repeatPenalty,
  });
};
```

#### 2.4 Update API Client

**File:** `packages/ui/src/api/ollama.ts`

Note: The modal imports `setOllamaModel` from `../../../api/api`, which re-exports from `ollama.ts`. No import changes required.

```typescript
export const setOllamaModel = async (
  modelName: string,
  contextSize?: number | null,
  temperature?: number,
  topP?: number,
  repeatPenalty?: number
): Promise<{ message: string }> => {
  return fetch('/api/ollama/set-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelName,
      contextSize,
      temperature,
      topP,
      repeatPenalty,
    }),
  }).then((res) => res.json());
};
```

## Benefits

1. **Simplifies Session Sidebar:** Removes confusing model configuration from the session-focused sidebar
2. **Functional Completeness:** Wires up existing UI controls (temperature, top-p, repeat penalty) to actually affect LLM output
3. **Clear Separation of Concerns:**
   - **Model Configuration:** Global settings for the active LLM
   - **Session Metadata:** Per-session information (client name, date, therapy type)
4. **Consistent User Experience:** All model-related settings are configured in one place
5. **Default System Prompt:** Provides a global default while preserving the option for future per-session overrides if needed

## Additional Implementation Notes

### API Response Update

The `/api/ollama/status` endpoint should be extended to return the configured sampling parameters so the modal can initialize with current values:

```typescript
// Update OllamaStatusResponseSchema to include:
configuredTemperature: t.Optional(t.Number()),
configuredTopP: t.Optional(t.Number()),
configuredRepeatPenalty: t.Optional(t.Number()),
```

### Type Updates

Update `OllamaStatus` type in `packages/ui/src/types/index.ts` to include the new parameters.

## Future Considerations

### Per-Session Overrides (Optional Enhancement)

If the need arises for per-session overrides of these parameters, we can:

1. Store overrides in the `sessions` table in SQLite
2. Add a "Override Model Defaults" toggle in the Run Configuration sidebar
3. When toggled, show the parameter controls (initially populated with global defaults)
4. Pass session-specific overrides in chat requests via the `options` parameter in `streamChatResponse`

This approach maintains a clear default → override hierarchy while keeping the initial implementation clean and focused.
