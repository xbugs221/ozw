// @ts-nocheck -- Playwright fixtures intentionally use dynamic JSON state.
/**
 * PURPOSE: 验收测试：wo v1.2.0 七阶段工作流在真实 UI 中可读、可跳转、可刷新。
 * 该规格使用最小 sealed runner state 覆盖 card/detail/acceptance/qa session
 * 和缺失 archive artifact warning，避免只在服务端读模型层面通过。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  authHeaders,
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';
import { PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from '../e2e/helpers/playwright-fixture.ts';
import { resolveFlowRunStatePath } from '../../backend/domains/workflows/flow-runtime-paths.ts';

const RUN_ID = 'run-fixture';

/**
 * Match the server's live-only project route identifier for a discovered path.
 */
function buildLiveProjectName(projectPath) {
  return projectPath.replace(/[\\/:\s~_]/g, '-');
}

/**
 * Write project-scoped artifacts used by the seven-stage workflow fixture.
 */
function writeArtifact(projectPath, relativePath, content) {
  fs.mkdirSync(path.dirname(path.join(projectPath, relativePath)), { recursive: true });
  fs.writeFileSync(path.join(projectPath, relativePath), content, 'utf8');
}

/**
 * Rewrite the shared fixture run into a minimal wo v1.2.0 state.
 */
function writeSevenStageWorkflowFixture() {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  writeArtifact(projectPath, '.local/share/wo/run-fixture/acceptance-summary.md', '# Acceptance\n\nUI path accepted.\n');
  writeArtifact(projectPath, '.local/share/wo/run-fixture/qa-1.json', JSON.stringify({ decision: 'pass' }, null, 2));
  writeArtifact(projectPath, '.local/share/wo/run-fixture/review-1.json', JSON.stringify({ findings: [] }, null, 2));
  writeArtifact(projectPath, '.local/share/wo/run-fixture/fix-1-summary.md', '# Fix\n\nNo findings.\n');

  const statePath = resolveFlowRunStatePath(projectPath, RUN_ID);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const nextState = {
    ...state,
    run_id: RUN_ID,
    change_name: '56-适配wo-v1-2-0七阶段工作流',
    sealed: true,
    status: 'running',
    stage: 'archive',
    stages: {
      planning: 'completed',
      acceptance: 'completed',
      execution: 'completed',
      review_1: 'completed',
      fix_1: 'completed',
      qa: 'completed',
      archive: 'active',
    },
    sessions: {
      'codex:planner': 'fixture-project-session',
      'codex:acceptance': 'acceptance-session-v120',
      'codex:executor': 'executor-session-v120',
      'codex:reviewer': 'reviewer-session-v120',
      'codex:fixer': 'fixer-session-v120',
      'codex:qa': 'qa-session-v120',
      'codex:archiver': 'archive-session-v120',
    },
    processes: [
      { stage: 'acceptance', role: 'acceptance', status: 'completed', sessionId: 'acceptance-session-v120' },
      { stage: 'execution', role: 'executor', status: 'completed', sessionId: 'executor-session-v120' },
      { stage: 'review_1', role: 'reviewer', status: 'completed', sessionId: 'reviewer-session-v120' },
      { stage: 'fix_1', role: 'fixer', status: 'completed', sessionId: 'fixer-session-v120' },
      { stage: 'qa', role: 'qa', status: 'completed', sessionId: 'qa-session-v120' },
      { stage: 'archive', role: 'archiver', status: 'running', sessionId: 'archive-session-v120' },
    ],
    paths: {
      acceptance_summary: '.local/share/wo/run-fixture/acceptance-summary.md',
      review_1: '.local/share/wo/run-fixture/review-1.json',
      fix_1_summary: '.local/share/wo/run-fixture/fix-1-summary.md',
      qa: '.local/share/wo/run-fixture/qa-1.json',
    },
  };
  delete nextState.workflow_display;
  fs.writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
}

/**
 * Advance the same fixture run after the detail page has already cached it.
 */
function completeArchiveForSevenStageWorkflowFixture() {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const deliverySummary = '.local/share/wo/run-fixture/delivery-summary.md';
  writeArtifact(projectPath, deliverySummary, '# Delivery\n\nArchive package completed.\n');
  const statePath = resolveFlowRunStatePath(projectPath, RUN_ID);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  fs.writeFileSync(statePath, `${JSON.stringify({
    ...state,
    status: 'completed',
    stage: 'archive',
    updated_at: '2026-06-01T10:30:00.000Z',
    stages: {
      ...state.stages,
      archive: 'completed',
    },
    paths: {
      ...(state.paths || {}),
      delivery_summary: deliverySummary,
    },
  }, null, 2)}\n`, 'utf8');
}

/**
 * Decide whether a browser request failure is an expected lifecycle cancellation.
 */
function isExpectedRequestCancellation(request) {
  const errorText = request.failure()?.errorText || '';
  return request.url().includes('/api/commands/list') && /ERR_ABORTED|abort|cancel/i.test(errorText);
}

/**
 * Open the workflow detail page and wait until backend detail fields are loaded.
 */
async function openWorkflowDetail(page) {
  const workflowDetailResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response.url().includes('/api/projects/')
    && /\/workflows\/[^/?]+(?:\?|$)/.test(response.url())
  ));
  await page.getByTestId('project-overview-workflows').getByRole('button', { name: /七阶段工作流/ }).first().click();
  const response = await workflowDetailResponse;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
}

test.describe('wo v1.2.0 七阶段工作流 UI', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
    await openFixtureProject(page);
    writeSevenStageWorkflowFixture();
    await page.reload({ waitUntil: 'networkidle' });
  });

  test('项目卡片和详情页按 archive 而非 qa 判断完成，并展示七阶段产物', async ({ page }) => {
    const consoleErrors = [];
    const requestFailures = [];
    const apiFailures = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('requestfailed', (request) => {
      if (isExpectedRequestCancellation(request)) {
        return;
      }
      requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        apiFailures.push(`${response.status()} ${response.url()}`);
      }
    });

    const workflowCard = page.getByTestId('project-overview-workflows').getByRole('button', { name: /七阶段工作流/ }).first();
    await expect(page.getByTestId('project-overview-workflows').getByRole('button', { name: /批量任务.*0\/1/ })).toBeVisible();
    await expect(workflowCard.getByTestId('workflow-stage-progress-qa')).toHaveCount(1);
    await expect(workflowCard.getByTestId('workflow-stage-progress-archive')).toHaveCount(1);
    const detailApiResponse = await page.request.get(
      `/api/projects/${encodeURIComponent(buildLiveProjectName(PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0]))}/workflows/${RUN_ID}`,
      { headers: authHeaders() },
    );
    expect(detailApiResponse.ok()).toBeTruthy();

    await page.screenshot({ path: 'tests/test-results/56-wo-v120-overview.png', fullPage: true });
    await openWorkflowDetail(page);

    await expect(page.getByTestId('workflow-status-tree-row-acceptance')).toBeVisible();
    await expect(page.getByTestId('workflow-status-tree-row-qa')).toBeVisible();
    await expect(page.getByRole('button', { name: 'acceptance-summary.md' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'qa-1.json' })).toBeVisible();
    await expect(page.getByText('delivery-summary.md 尚未生成。')).toHaveCount(0);
    await page.screenshot({ path: 'tests/test-results/56-wo-v120-detail.png', fullPage: true });
    await page.screenshot({ path: 'tests/test-results/56-wo-v120-missing-artifact.png', fullPage: true });

    completeArchiveForSevenStageWorkflowFixture();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'delivery-summary.md' })).toBeVisible();

    await page.getByTestId('workflow-status-tree-row-acceptance').getByRole('button').first().click();
    await expect(page).toHaveURL(/\/runs\/run-fixture\/sessions\/acceptance$/);
    await page.screenshot({ path: 'tests/test-results/56-wo-v120-acceptance-session.png', fullPage: true });

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
    await page.getByTestId('workflow-status-tree-row-qa').getByRole('button').first().click();
    await expect(page).toHaveURL(/\/runs\/run-fixture\/sessions\/qa$/);
    await page.screenshot({ path: 'tests/test-results/56-wo-v120-qa-session.png', fullPage: true });

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
    await expect(page.getByRole('button', { name: 'delivery-summary.md' })).toBeVisible();
    await page.screenshot({ path: 'tests/test-results/56-wo-v120-after-refresh.png', fullPage: true });
    expect(consoleErrors).toEqual([]);
    expect(requestFailures).toEqual([]);
    expect(apiFailures).toEqual([]);
  });
});
