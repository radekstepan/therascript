---
'@therascript/worker': patch
'@therascript/db': patch
'@therascript/ui': patch
---

# Task 5: Judge LLM thinking, sampling, context budget, and prompt fixes

Fixes the five compounding bugs that made reasoning-model audits (e.g. `qwen3.8-27b`) burn their whole completion allowance inside `<think>` and return no JSON:

- **Thinking is never clamped or disabled.** The worker's 2048 clamp and the retry's `thinkingBudget: 0` / `enable_thinking: false` are gone; the job budget passes through (`-1` unrestricted by default, Session Chat parity) and retries keep it with lower temperature plus a brief-thinking reminder.
- **Sampling defaults survive model selection.** `LlmSettingsForm` accepts caller-provided `defaultSamplingParams`, so opening the verification modal no longer silently resets `temperature` 0.3 → 0.7 when the active model is `default`.
- **Completion budget uses the real remainder.** The artificial 30%-of-context cap is replaced by sizing from the actual post-selection prompt, so a 50k window with a 17k prompt offers ~33k tokens for `<think>` + JSON instead of 15k.
- **Session Chat message layout.** The transcript moves into the system prompt (stable, KV-cache-friendly prefix) with a focused user turn, normalized via `prepareLlmChatMessages`.
- **Streamlined Judge prompt.** No more `timestampMs` millisecond math or `speaker` copying (hydration fills both from `paragraphIndex`); explicit brief-`<think>`, 15–25 claim-grouping, and one-sentence-reasoning guidance. Existing databases whose seeded prompt still matches a prior built-in default are upgraded automatically; genuine custom edits are preserved.
