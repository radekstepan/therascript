---
'@therascript/ui': patch
---

# Chat input yields to a model state panel until the model is ready

- `ChatInput` no longer renders a disabled input with per-reason placeholders/tooltips while the model isn't ready. Instead the input row is replaced by a `model-state-panel` (status text + a "Configure AI Model" action that opens the model picker): spinner while loading, "No model selected" / "Model failed to load" / "LLM server unreachable" / "Wrong model loaded" otherwise. The input row fades back in (`chat-input-fade-in`, honoring `prefers-reduced-motion`) once the status poll confirms the model is loaded.
- Removes the queued `pendingMessage` send-after-load flow and the toast/disabled-reason plumbing (`toastMessageAtom`, `queryClient` refetch, send-button `aria-label` variants); submit now simply guards on `isModelReady`. Disabled state is expressed by unmounting the input rather than `disabled={true}`.
- New `ChatInput.test.tsx` (jsdom): panel-vs-input contract across checking/loading/ready/not-loaded/no-model/failed/mismatch/unreachable states.
