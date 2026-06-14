/**
 * PURPOSE: 验收测试：需求工作流详情路由与会话流程图预览交互。
 * Derived from openspec/changes/2030-ozw-ui/specs/project-workflow-control-plane/spec.md.
 */
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFixtureProject,
  openFixtureManualSessionFromOverview,
} from './helpers/spec-test-helpers.ts';

test.describe('需求工作流详情路由与会话流程图预览', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
  });

  test('侧边栏只显示项目清单，详情入口留在项目主页', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByTestId('project-workspace-nav')).toHaveCount(0);
    await expect(page.getByTestId('project-list')).toBeVisible();
    await expect(page.getByTestId('project-workflow-group')).toHaveCount(0);
    await expect(page.getByTestId('manual-session-group')).toHaveCount(0);
    await page.getByTestId('project-list-item-fixture-project-desktop-surface').click();
    await expect(page.getByTestId('project-overview-workflows')).toContainText('登录升级');
    await expect(page.getByTestId('project-overview-manual-sessions')).toContainText('fixture-project manu');
  });

  test('工作流详情展示阶段树，工作流会话不展示流程图预览', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page).toHaveURL(/\/workspace\/fixture-project\/runs\/run-fixture$/);
    await expect(page.getByRole('heading', { name: '登录升级' }).last()).toBeVisible();
    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
    await expect(page.getByTestId('workflow-stage-mini-map')).toHaveCount(0);
    await expect(page.getByTestId('workflow-stage-tree')).toHaveCount(0);

    await page.getByTestId('workflow-status-tree-row-execution').getByRole('button', { name: '执行阶段' }).click();
    await expect(page).toHaveURL(/\/workspace\/fixture-project\/runs\/run-fixture\/sessions\/execution$/);
    await expect(page.getByTestId('workflow-minimap')).toHaveCount(0);
    await expect(page.getByTestId('workflow-minimap-drag-handle')).toHaveCount(0);
    await expect(page.getByTestId('workflow-stage-tree-preview')).toHaveCount(0);
  });

  test('手动会话详情不展示工作流流程图预览', async ({ page }) => {
    await openFixtureProject(page);
    await openFixtureManualSessionFromOverview(page);

    await expect(page).toHaveURL(/\/workspace\/fixture-project\/c\d+$/);
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toContainText(
      'fixture-project manual-only session assistant turn 01',
    );
    await expect(page.getByTestId('workflow-minimap')).toHaveCount(0);
    await expect(page.getByTestId('workflow-minimap-drag-handle')).toHaveCount(0);
    await expect(page.getByTestId('workflow-stage-tree-preview')).toHaveCount(0);
  });
});
