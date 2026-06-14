// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Playwright acceptance test — verify core frontend business paths
 * survive simplification. Exercises real user actions: send chat, edit +
 * save file, switch providers, view diagnostics, enter workflow details,
 * and Shell.
 *
 * Change: 30-进一步精简仓库源码和脚本资源
 *
 * Derived from proposal.md:60, design.md:111, spec.md:96-132.
 */
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  authenticatePage,
  openFixtureProject,
  openFilesTab,
  writeWorkspaceTextFile,
  resetWorkspaceProject,
  resolveFlowrkspacePath,
} from './helpers/spec-test-helpers.ts';

// ── Chat send (real submit via Ctrl+Enter) ─────────────────────────────────

test('在手动会话中发送消息后文本区清空（验证 form submit 被触发）', async ({ page }) => {
  // Spy on WebSocket.send so we can assert a message was dispatched
  const sentMessages = [];
  await page.addInitScript(() => {
    const origSend = window.WebSocket.prototype.send;
    window.WebSocket.prototype.send = function (data) {
      window.__ozw_ws_sent = (window.__ozw_ws_sent || 0) + 1;
      window.__ozw_ws_last_data = data;
      return origSend.call(this, data);
    };
  });

  await openFixtureProject(page);
  const sessionBtn = page.getByRole('button', { name: /fixture-project manu/ }).first();
  await expect(sessionBtn).toBeVisible({ timeout: 10_000 });
  await sessionBtn.click();

  const transcript = page.getByTestId('chat-scroll-container');
  await expect(transcript).toBeVisible({ timeout: 10_000 });

  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.fill('sent-from-simplification-test');

  // Press Ctrl+Enter inside the textarea → triggers form submit → WebSocket send
  const wsSentBefore = await page.evaluate(() => window.__ozw_ws_sent || 0);
  await textarea.press('Control+Enter');

  // After submit, textarea should clear
  await expect(textarea).toHaveValue('', { timeout: 3_000 });

  // A WebSocket send should have been dispatched
  const wsSentAfter = await page.evaluate(() => window.__ozw_ws_sent || 0);
  expect(wsSentAfter).toBeGreaterThan(wsSentBefore);
});

// ── File edit + save ───────────────────────────────────────────────────────

test('在编辑器中编辑文件内容后保存，fixture 文件内容被持久化', async ({ page }) => {
  const filePath = 'src/simplified-save-check.ts';
  const originalContent = 'export const BEFORE = "before-save";\n';
  const editedText = 'SAVED';

  await resetWorkspaceProject();
  await writeWorkspaceTextFile(filePath, originalContent);

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);

  // Navigate to file
  await page.getByText('src', { exact: true }).click();
  await page.getByText('simplified-save-check.ts', { exact: true }).click();
  await expect(page.getByRole('button', { name: /Save/i })).toBeVisible({ timeout: 8_000 });

  // Edit: click into editor, append text at end, then save.
  // We append rather than replacing to avoid platform-specific select-all issues.
  const editor = page.locator('.cm-content').first();
  await editor.click();
  // Navigate to end of the one-line file
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const marker = 'SIMPLIFICATION-SAVE-VERIFIED';
  await page.keyboard.type(marker);

  // Click Save
  await page.getByRole('button', { name: /Save/i }).click();

  // Wait for save to complete
  await page.waitForTimeout(500);

  // Verify fixture file on disk contains the appended marker
  const diskContent = await readFile(resolveFlowrkspacePath(filePath), 'utf8');
  expect(diskContent).toContain(marker);
});

// ── Shell ──────────────────────────────────────────────────────────────────

test('Shell 标签页切换后终端容器可见', async ({ page }) => {
  await openFixtureProject(page);
  await page.getByTestId('tab-shell').click();
  await expect(
    page.locator('.xterm, .xterm-viewport, [data-testid="dock-panel-bottom"]').first(),
  ).toBeVisible({ timeout: 8_000 });
});

// ── Removed Git UI ─────────────────────────────────────────────────────────

test('主工作区不再显示 Git 标签且保留文件和终端入口', async ({ page }) => {
  await openFixtureProject(page);

  await expect(page.locator(`[data-testid="tab-${'git'}"]`)).toHaveCount(0);
  await expect(page.getByTestId('tab-files')).toBeVisible();
  await expect(page.getByTestId('tab-shell')).toBeVisible();
});

// ── Settings + provider switching ──────────────────────────────────────────

test('设置页只展示当前支持的智能体', async ({ page }) => {
  let removedProviderStatusRequests = 0;
  await page.route('/api/cli/opencode/status', async (route) => {
    removedProviderStatusRequests += 1;
    await route.abort();
  });
  await authenticatePage(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /设置|Settings/ }).first().click();

  await expect(page.getByRole('tab', { name: /智能体|Agents/ })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('tab', { name: /智能体|Agents/ }).click();

  await expect(page.getByRole('button', { name: /Codex/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pi/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /OpenCode/ })).toHaveCount(0);
  expect(removedProviderStatusRequests).toBe(0);
});

// ── Diagnostics ────────────────────────────────────────────────────────────

test('诊断页展示运行时依赖检查信息', async ({ page }) => {
  await page.route('/api/diagnostics/runtime-dependencies', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        commands: {
          oz: { version: { ok: true, output: 'oz-simplified' } },
          wo: { version: { ok: true, output: 'wo-simplified' } },
        },
      }),
    });
  });

  await authenticatePage(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /设置|Settings/ }).first().click();
  await page.getByRole('tab', { name: /诊断|Diagnostics/ }).click();

  await expect(page.getByText('oz-simplified')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('wo-simplified')).toBeVisible();
});

// ── Workflow detail ────────────────────────────────────────────────────────

test('workflow 详情页展示 run-fixture 工作流阶段信息', async ({ page }) => {
  await openFixtureProject(page);

  const loginUpgradeBtn = page.getByRole('button', { name: /登录升级/ });
  await expect(loginUpgradeBtn).toBeVisible({ timeout: 5_000 });
  await loginUpgradeBtn.click();

  await expect(page.getByTestId('project-list')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /登录升级/ }).last()).toBeVisible();

  await expect(page.locator('[data-testid^="workflow-stage-"]').first())
    .toBeVisible({ timeout: 8_000 });
});
