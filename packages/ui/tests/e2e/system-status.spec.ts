// packages/ui/tests/e2e/system-status.spec.ts
//
// E2E for the system/ops status surface: the GPU "System Resources"
// modal reachable from the sidebar, plus the Docker status/logs API
// contract.
//
// Notes:
//   - The seeded GPU stats report `available: false` with no runtime
//     provider, so the modal renders the "unavailable" state.
//   - DockerStatusModal.tsx is currently not mounted anywhere in the
//     UI (orphan component), so there is no user path to drive it.
//     The Docker endpoints are instead asserted via page-context
//     fetch (which MSW intercepts like any other /api/* call),
//     pinning the contract the modal will consume once wired up.
//
// Reference: packages/ui/src/components/User/GpuStatusIndicator.tsx,
// GpuStatusModal.tsx, DockerStatusModal.tsx, and
// packages/ui/src/mocks/handlers/system.ts.
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

test.describe.serial('System status surface', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  test('opens the System Resources modal from the sidebar', async ({
    page,
  }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /Runtime:/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('System Resources')).toBeVisible();
    await expect(
      dialog.getByText('Runtime information is not available yet.')
    ).toBeVisible();
    await expect(dialog.getByText(/nvidia-smi.*not found/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('docker status and logs endpoints match the modal contract', async ({
    page,
  }) => {
    await page.goto('/');

    const status = await page.evaluate(async () => {
      const res = await fetch('/api/docker/status');
      return { status: res.status, body: await res.json() };
    });
    expect(status.status).toBe(200);
    expect(Array.isArray(status.body.containers)).toBe(true);
    expect(status.body.containers.length).toBeGreaterThan(0);
    const names = status.body.containers.map((c: { name: string }) => c.name);
    expect(names).toContain('therascript_whisper_service');
    for (const c of status.body.containers) {
      expect(typeof c.state).toBe('string');
    }

    const logs = await page.evaluate(async () => {
      const res = await fetch('/api/docker/logs/therascript_whisper_service');
      return { status: res.status, body: await res.json() };
    });
    expect(logs.status).toBe(200);
    expect(typeof logs.body.logs).toBe('string');
    expect(logs.body.logs).toContain('therascript_whisper_service');
  });
});
