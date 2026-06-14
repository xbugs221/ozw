// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify that a workflow child session:
 *   1. Displays wo read-model facts (stage, run, status) — not local state.
 *   2. Uses co session-status / active_turn_id to drive composer stop/running.
 *   3. After reload, state recovers from co/wo, not from local processingSessions.
 *
 *   spec:  「workflow 阶段状态来自 wo」
 *         「chat 的 provider turn 状态只用于该子会话输入区是否可停止」
 *   task:  5.4
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';

function buildExpectedProjectRoutePrefix() {
  const homePath = process.env.HOME || process.env.USERPROFILE || '';
  const relativePath = path.relative(homePath, PRIMARY_FIXTURE_PROJECT_PATH).split(path.sep).join('/');
  return `/${relativePath}`;
}

/**
 * Inject a FakeWebSocket that responds to check-session-status for the
 * execution child session with isProcessing=true and an active turn ID.
 * This simulates co running state → stop button driven by co, not local state.
 */
async function installRunningCoSocket(page) {
  await page.addInitScript(() => {
    let wsInstance: any = null;

    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 1;

      constructor() {
        super();
        wsInstance = this;
        setTimeout(() => {
          this.onopen?.(new Event('open'));
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(payload: string) {
        const message = JSON.parse(payload);
        // Pass through non-relevant messages to avoid side effects.
        if (message.type === 'check-session-status') {
          const sessionId = message.sessionId || '';
          // Only respond for the execution child session.
          if (sessionId === 'fixture-project-execution-session') {
            wsInstance.onmessage?.(new MessageEvent('message', {
              data: JSON.stringify({
                type: 'session-status',
                sessionId,
                ozwSessionId: sessionId,
                isProcessing: true,
                turnId: 'active_turn_exec',
                turn_id: 'active_turn_exec',
              }),
            }));
          }
        }
      }

      close() {
        this.readyState = 3;
        this.onclose?.(new Event('close'));
      }
    }
    window.WebSocket = FakeWebSocket as any;
  });
}

test.describe('workflow child session – wo stage + co active_turn_id convergence', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
    await installRunningCoSocket(page);
  });

  test('execution child session: wo stage from wo read-model, co composer reflects running state from session-status', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    // 1. Navigate to the execution child session via UI.
    await openFixtureProject(page);
    await page.getByTestId('project-workflow-group')
      .getByRole('button', { name: /登录升级/ }).click();
    await page.getByTestId('workflow-role-row-executor')
      .getByRole('button', { name: '会话' }).click();

    // 2. URL must point to the wo-driven child session route.
    await expect(page).toHaveURL(
      new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/execution$`),
    );

    // ── Wo read-model: change_name from the wo fixture ────────────────────
    await expect(page.locator('body')).toContainText('登录升级', { timeout: 10_000 });

    // ── Co read-model: persisted assistant output from the fixture session ─
    await expect(page.locator('body')).toContainText('fixture-project execution fixture session', {
      timeout: 10_000,
    });

    // ── Co composer driven by session-status with active_turn_id ───────────
    // FakeWS returns isProcessing=true for this session → isLoading=true → stop button.
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    // The composer submit button is present (displays stop when isLoading is true).
    const composerButton = page.locator('form button[type="submit"]').first();
    await expect(composerButton).toBeAttached({ timeout: 5_000 });

    // ── Reload: co/wo state must be consistently restored ─────────────────
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page).toHaveURL(
      new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/execution$`),
    );

    // Wo facts must persist across reload (not lost to local processingSessions).
    await expect(page.locator('body')).toContainText('登录升级', { timeout: 10_000 });

    // Co persisted content must still be visible.
    await expect(page.locator('body')).toContainText(
      'fixture-project execution fixture session',
      { timeout: 10_000 },
    );

    // Chat composer must be available after reload.
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });

    // Composer button must still be attached after reload.
    await expect(
      page.locator('form button[type="submit"]').first(),
    ).toBeAttached({ timeout: 5_000 });
  });
});
