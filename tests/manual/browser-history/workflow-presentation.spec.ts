// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: 验收测试：多轮 wo 工作流在卡片和详情页保持紧凑且可跳转。
 * 测试通过真实 fixture run state 进入页面，覆盖用户查看与点击产物的业务路径。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';
import { PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from '../../e2e/helpers/playwright-fixture.ts';
import { resolveFlowRunStatePath } from '../../../backend/domains/workflows/flow-runtime-paths.ts';

/**
 * Write a multi-round wo state fixture and matching artifact files for UI tests.
 */
function writeMultiRoundWorkflowFixture() {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const reviewOne = '.local/share/wo/run-fixture/review-1.json';
  const reviewTwo = '.local/share/wo/run-fixture/review-2.json';
  const repairOne = '.local/share/wo/run-fixture/repair-1.md';
  for (const relativePath of [reviewOne, reviewTwo, repairOne]) {
    const absolutePath = path.join(projectPath, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(
      absolutePath,
      relativePath.endsWith('.md') ? '# 修复说明\n\n已处理审核问题。\n' : JSON.stringify({ path: relativePath }),
      'utf8',
    );
  }

  const statePath = resolveFlowRunStatePath(projectPath, 'run-fixture');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const nextState = {
    ...state,
    status: 'running',
    stage: 'review_2',
    stages: {
      execution: 'completed',
      review_1: 'completed',
      repair_1: 'completed',
      review_2: 'running',
    },
    sessions: {
      'codex:executor': 'executor-session-long-id',
      'codex:reviewer': 'reviewer-session-long-id',
    },
    processes: [
      { stage: 'execution', role: 'executor', status: 'completed', sessionId: 'executor-session-long-id' },
      { stage: 'repair_1', role: 'executor', status: 'completed', sessionId: 'executor-session-long-id' },
      { stage: 'review_2', role: 'reviewer', status: 'running', sessionId: 'reviewer-session-long-id' },
    ],
    paths: {
      review_1: reviewOne,
      review_2: reviewTwo,
      repair_1_summary: repairOne,
    },
  };
  delete nextState.workflow_display;
  fs.writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
}

/**
 * Return the project overview workflow card, expanding the section only when
 * the project overview has not already rendered cards.
 */
async function getOverviewWorkflowCard(page) {
  const workflowsPanel = page.getByTestId('project-overview-workflows');
  const workflowCard = workflowsPanel.getByRole('button', { name: /登录升级/ }).first();
  if (await workflowCard.count() === 0) {
    await workflowsPanel.getByRole('button', { name: /自动工作流/ }).click();
  }
  return workflowCard;
}

test.describe('多轮工作流呈现', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
    await openFixtureProject(page);
    writeMultiRoundWorkflowFixture();
    await page.reload({ waitUntil: 'networkidle' });
  });

  test('项目卡片聚合审核和修复轮次', async ({ page }) => {
    const workflowCard = await getOverviewWorkflowCard(page);

    await expect(workflowCard.getByTestId('workflow-stage-progress-review')).toHaveCount(1);
    await expect(workflowCard.getByTestId('workflow-stage-progress-repair')).toHaveCount(1);
    await expect(workflowCard).toContainText('x2');
    await expect(workflowCard).toContainText('x1');
  });

  test('详情阶段树显示当前轮次产物并可跳转会话', async ({ page }) => {
    const workflowCard = await getOverviewWorkflowCard(page);
    const workflowDetailResponse = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/api/projects/')
      && /\/workflows\/[^/?]+(?:\?|$)/.test(response.url())
    ));
    await workflowCard.click();
    await workflowDetailResponse;

    const stageTree = page.getByTestId('workflow-status-tree');
    const executionRow = page.getByTestId('workflow-status-tree-row-execution');
    const reviewOneRow = page.getByTestId('workflow-status-tree-row-review_1');
    const repairOneRow = page.getByTestId('workflow-status-tree-row-repair_1');
    const reviewTwoRow = page.getByTestId('workflow-status-tree-row-review_2');
    await expect(stageTree).toBeVisible();
    await expect(executionRow.getByRole('button', { name: '执行阶段' })).toBeVisible();
    await expect(reviewOneRow.getByRole('button', { name: 'Review result 1' })).toBeVisible();
    await expect(repairOneRow.getByRole('button', { name: 'Repair summary 1' })).toBeVisible();
    await expect(reviewTwoRow.getByRole('button', { name: 'Review result 2' })).toBeVisible();
    await expect(reviewTwoRow).not.toContainText('review-1.json');

    await reviewTwoRow.getByRole('button', { name: 'Review result 2' }).click();
    await expect(page.getByRole('heading', { name: 'review-2.json' })).toBeVisible();

    await page.getByRole('button', { name: /侧栏需求工作流/ }).click();
    const refreshedReviewTwoRow = page.getByTestId('workflow-status-tree-row-review_2');
    await expect(refreshedReviewTwoRow).toBeVisible();
    await refreshedReviewTwoRow.getByRole('button', { name: '审核阶段' }).click();
    await expect(page).toHaveURL(/\/runs\/run-fixture\/sessions\/review_2$/);
  });
});
