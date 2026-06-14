/**
 * PURPOSE: 验收测试：从已有工作流子会话创建新的工作流时，聊天视图不得串用旧会话消息。
 * Derived from openspec/changes/18-ozw-bug/specs/project-workflow-control-plane/spec.md
 * and openspec/changes/18-ozw-bug/specs/project-route-addressing/spec.md.
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';

/**
 * Build the expected project route prefix from the Playwright fixture home.
 *
 * @returns {string}
 */
function buildExpectedProjectRoutePrefix() {
  const homePath = process.env.HOME || process.env.USERPROFILE || '';
  const relativePath = path.relative(homePath, PRIMARY_FIXTURE_PROJECT_PATH).split(path.sep).join('/');
  return `/${relativePath}`;
}

test.describe('工作流子会话隔离', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
  });

  test('从 runId 子会话创建新工作流后，不再展示旧子会话历史消息', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();
    await page.getByTestId('workflow-role-row-executor').getByRole('button', { name: '会话' }).click();

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/execution$`));

    await expect(page.locator('[data-testid="chat-scroll-container"]')).not.toContainText(
      'fixture-project session assistant turn 01',
    );

    await page.reload({ waitUntil: 'networkidle' });

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/execution$`));
    await expect(page.locator('[data-testid="chat-scroll-container"]')).not.toContainText(
      'fixture-project session assistant turn 01',
    );
  });
});
