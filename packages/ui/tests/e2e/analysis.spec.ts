// packages/ui/tests/e2e/analysis.spec.ts
//
// E2E flow for the "deep analysis" path (CreateAnalysisJobModal +
// AnalysisJobsPage). Modeled after session-chat.spec.ts: opens the
// Landing page, drives a multi-session analysis through to the detail
// view, and asserts the end-state MapReduce UI is rendered.
//
//   1. Open the Landing page and assert both mocked sessions are listed.
//   2. Select all sessions via the header checkbox.
//   3. Click "Analyze Selected (2)" to open the dialog.
//   4. Assert "Use Advanced Analysis Strategy" is already checked (the
//      modal defaults to the deep map-reduce path).
//   5. Type an analysis prompt.
//   6. Pick a model from the LlmSettingsForm combobox (default local).
//   7. Click "Submit Analysis" and assert navigation to /analysis-jobs.
//   8. Click the job row to open the detail view.
//   9. Assert the end-state UI:
//        - Analysis #1 heading
//        - Original Prompt block matches the typed text
//        - Intermediate Task block shows the mocked strategy
//          intermediate_question
//        - Intermediate Analysis shows one completed card per selected
//          session
//        - Final Synthesized Answer heading + the mocked reduce text
//        - The final-answer tokens/s metric renders (proves the SSE
//          `end` event with completionTokens + duration was consumed)
//        - The Model: field shows the selected model
//
// State isolation:
//   - The MSW handlers in src/mocks/handlers.ts hold the analysis job
//     state in module-level mutable state (mockAnalysisJob). This spec
//     uses `test.describe.serial` so the create/list/detail state
//     transitions are well-ordered inside a single worker.
//
// Reference: packages/ui/src/mocks/handlers.ts for the mock surface,
// packages/ui/src/components/Analysis/CreateAnalysisJobModal.tsx for
// the dialog, packages/ui/src/components/Analysis/AnalysisJobsPage.tsx
// for the detail view, and packages/ui/src/hooks/useAnalysisStream.ts
// for the SSE event-shape contract.
import { test, expect } from '@playwright/test';

const SELECTED_LOCAL_MODEL = 'qwen2.5-7b-instruct';
const ANALYZED_PROMPT =
  'What are the recurring themes of anxiety across these sessions?';
const STRATEGY_INTERMEDIATE_QUESTION_FRAGMENT = 'recurring anxiety triggers';
const REDUCED_ANSWER_FRAGMENT = 'partial success applying it';

test.describe.serial('Deep analysis (MapReduce) end-to-end', () => {
  test('submits a multi-session advanced-strategy job and renders the result', async ({
    page,
  }) => {
    // ---- 1. Open the Landing page --------------------------------------
    await page.goto('/');

    // Session History card mounts once /api/sessions/ resolves. The
    // table renders both mocked sessions (intake + follow-up) and the
    // "Analyze Selected" button is disabled until at least one row is
    // selected.
    const main = page.locator('main');
    const sessionHistoryHeading = main.getByRole('heading', {
      name: /Session History/i,
    });
    await expect(sessionHistoryHeading).toBeVisible();

    // Both sessions from the MSW handlers must be present so the
    // multi-select has something to operate on.
    await expect(main.getByText('Intake Session')).toBeVisible();
    await expect(main.getByText('Follow-up Session')).toBeVisible();

    const analyzeButton = main.getByRole('button', {
      name: /Analyze Selected/,
    });
    await expect(analyzeButton).toBeDisabled();

    // ---- 2. Select all sessions via the header checkbox ----------------
    // SessionListTable.tsx:348 renders an aria-labelled header checkbox
    // that toggles every row. We click it once to select both sessions
    // — strictly two so the test's "multi-session" assumption holds.
    const selectAll = main.getByRole('checkbox', {
      name: 'Select all sessions',
    });
    await selectAll.click();

    // The button label updates to reflect the selected count, and it
    // becomes enabled. Disambiguate the button from the rest of the
    // page with the `(2)` suffix.
    const analyzeButtonEnabled = main.getByRole('button', {
      name: /Analyze Selected \(2\)/,
    });
    await expect(analyzeButtonEnabled).toBeEnabled();

    // ---- 3. Open the analysis dialog -----------------------------------
    await analyzeButtonEnabled.click();

    // Dialog heading disambiguates from any other Radix Dialog in the
    // tree (none today, but pinning it keeps the spec stable if one is
    // added later — same defense the chat spec uses).
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Analyze Multiple Sessions')).toBeVisible();

    // ---- 4. Assert the "advanced strategy" checkbox is checked --------
    // CreateAnalysisJobModal.tsx:168 defaults useAdvancedStrategy to
    // true — that is the "deep" map-reduce path. The label is rendered
    // as the Checkbox's accessible name; we look it up by role + name
    // to be robust against future label copy changes.
    const advancedStrategyCheckbox = dialog.getByRole('checkbox', {
      name: /Use Advanced Analysis Strategy/,
    });
    await expect(advancedStrategyCheckbox).toBeChecked();

    // ---- 5. Type the analysis prompt -----------------------------------
    // The textarea is wired to the `<label htmlFor="analysisPrompt">`
    // in CreateAnalysisJobModal.tsx:432,455.
    const promptTextarea = dialog.locator('#analysisPrompt');
    await promptTextarea.fill(ANALYZED_PROMPT);

    // ---- 6. Pick a model from the LlmSettingsForm ----------------------
    // The analysis modal embeds LlmSettingsForm, which renders the
    // LlmEndpointModelPicker combobox. We open the Local default
    // (mockActiveModel is empty so the form starts with no model) and
    // pick a model. The picker is the only combobox inside the dialog.
    const modelCombobox = dialog.getByRole('combobox');
    await modelCombobox.click();
    await page
      .getByRole('option', { name: new RegExp(SELECTED_LOCAL_MODEL) })
      .click();
    // Clicking an option auto-closes the Radix Select.

    // ---- 7. Submit and assert navigation to /analysis-jobs ------------
    const submitButton = dialog.getByRole('button', {
      name: /Submit Analysis/,
    });
    await submitButton.click();

    // CreateAnalysisJobModal onSuccess navigates to the list page.
    await page.waitForURL('**/analysis-jobs');

    // The list view should show the job row. The MSW POST handler
    // stamps the short_prompt to "Anxiety Trends Analysis" — that
    // string is the easiest way to find the unique row regardless of
    // how many jobs other specs add.
    const jobRow = main.getByText('Anxiety Trends Analysis').first();
    await expect(jobRow).toBeVisible();

    // ---- 8. Click the row to navigate to the detail view ---------------
    // AnalysisJobsPage.tsx:772 wires each <Table.Row> with
    // onClick={() => navigate(`/analysis-jobs/${job.id}`)}. Clicking
    // the short_prompt cell avoids the per-row DotsHorizontalIcon
    // dropdown trigger in the Actions column (which has
    // e.stopPropagation on it).
    await jobRow.click();

    await page.waitForURL('**/analysis-jobs/1');

    // ---- 9. Assert the end-state UI ------------------------------------
    // 9a. Job detail heading + status badge.
    await expect(
      main.getByRole('heading', { name: 'Analysis #1' })
    ).toBeVisible();
    await expect(
      main.getByText('completed', { exact: true }).first()
    ).toBeVisible();

    // 9b. Original prompt is what we typed.
    await expect(main.getByText(ANALYZED_PROMPT)).toBeVisible();

    // 9c. Intermediate Task heading + the mocked strategy question.
    // AnalysisJobsPage.tsx:531 renders the heading "Intermediate Task"
    // and the strategy.intermediate_question text below it.
    await expect(
      main.getByRole('heading', { name: 'Intermediate Task' })
    ).toBeVisible();
    await expect(
      main.getByText(STRATEGY_INTERMEDIATE_QUESTION_FRAGMENT)
    ).toBeVisible();

    // 9d. Intermediate Analysis: one completed card per selected
    // session. The card title shows the session name; the
    // summary_text is collapsed behind a "Show Analysis" button
    // (AnalysisJobsPage.tsx:248). We assert the titles are visible,
    // then expand the first card to confirm the persisted summary
    // text is in the DOM.
    await expect(
      main.getByRole('heading', { name: 'Intermediate Analysis' })
    ).toBeVisible();
    const intakeCard = main
      .locator('[id^="summary-"]')
      .filter({ hasText: 'Intake Session' });
    const followupCard = main
      .locator('[id^="summary-"]')
      .filter({ hasText: 'Follow-up Session' });
    await expect(intakeCard).toBeVisible();
    await expect(followupCard).toBeVisible();
    // Expand the first card. The card is keyed by its id="summary-N"
    // and renders a "Show Analysis" Radix button; clicking it
    // toggles the card open and reveals the markdown summary text.
    await intakeCard.getByRole('button', { name: /Show Analysis/ }).click();
    await expect(
      intakeCard.getByText(/Session 1 analysis: noted anxiety spikes/i)
    ).toBeVisible();

    // 9e. Final Synthesized Answer heading + the mocked reduce text.
    // The SSE snapshot seeds reduceLog from job.final_result, so the
    // reduce body text is in the DOM as soon as the snapshot lands.
    await expect(
      main.getByRole('heading', { name: 'Final Synthesized Answer' })
    ).toBeVisible();
    await expect(main.getByText(REDUCED_ANSWER_FRAGMENT)).toBeVisible();

    // 9f. The final-answer tokens/s metric renders. AnalysisJobsPage.tsx
    // only renders this footer when `reduceMetrics.completionTokens`
    // and `reduceMetrics.tokensPerSecond` are both truthy, which only
    // happens when the SSE `end` event for the reduce phase was
    // consumed with non-zero values. This proves the deep-analysis
    // SSE flow ran end-to-end.
    await expect(
      main.getByText(/\d+ tokens \(\d+\.\d tokens\/s\)/)
    ).toBeVisible();

    // 9g. The Model: field shows the model we picked. This proves the
    // modal's setActiveModelAndContextAndParams snapshot flowed through
    // to the persisted job.model_name on the server side.
    const modelCell = main
      .locator('text=Model')
      .locator('..')
      .getByText(SELECTED_LOCAL_MODEL);
    await expect(modelCell).toBeVisible();
  });
});
