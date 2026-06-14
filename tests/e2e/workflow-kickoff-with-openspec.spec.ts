// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: 验证通过网页 UI 创建工作流并绑定已有 OpenSpec 变更后，
 * 工作流系统能自动检测变更并推进。
 *
 * 测试场景：
 * 1. 在 fixture 项目中准备 OpenSpec 变更文档
 * 2. 用 Playwright 模拟用户打开项目 -> 工作流操作 -> 多选已有 OpenSpec 变更 -> 启动
 * 3. 验证工作流被正确创建并绑定到 OpenSpec 变更
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';
import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
  authHeaders,
  getFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';

const OPEN_SPEC_CHANGE_NAME = '25-home-session-card-activity-ui';

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

/**
 * Prepare OpenSpec change documents in the fixture project.
 */
async function prepareOpenSpecChange(changeName = OPEN_SPEC_CHANGE_NAME) {
  /**
   * Create a real active oz change directory for workflow adoption tests.
   */
  const changeRoot = path.join(PRIMARY_FIXTURE_PROJECT_PATH, 'docs', 'changes', changeName);
  await fs.mkdir(changeRoot, { recursive: true });
  await fs.mkdir(path.join(changeRoot, 'specs'), { recursive: true });

  await fs.writeFile(
    path.join(changeRoot, '.openspec.yaml'),
    'schema: spec-driven\ncreated: 2026-04-28\n',
    'utf8',
  );

  await fs.writeFile(
    path.join(changeRoot, 'proposal.md'),
    `# 提案：${changeName}\n\n## 目标\n\n改进项目主页会话卡片的用户体验。\n`,
    'utf8',
  );

  await fs.writeFile(
    path.join(changeRoot, 'design.md'),
    '# 设计：优化项目主页会话卡片展示\n\n## 时间戳\n\n- 复用 `formatTimeAgo` 函数\n\n## 未读状态指示灯\n\n- 复用 `SidebarSessionItem.tsx` 中的 localStorage 签名机制\n\n## 右键菜单文字\n\n- 修改 `SessionActionIconMenu.tsx`\n',
    'utf8',
  );

  await fs.writeFile(
    path.join(changeRoot, 'tasks.md'),
    '# 任务清单\n\n- [ ] 修改 `SessionActionIconMenu.tsx`\n- [ ] 修改 `ProjectOverviewPanel.tsx`\n',
    'utf8',
  );
}

test('creating a workflow with existing OpenSpec change binds correctly', async ({ page }) => {
  test.setTimeout(60000);
  const projectRoutePrefix = buildExpectedProjectRoutePrefix();
  await openFixtureProject(page);

  // Prepare OpenSpec change AFTER fixture reset in openFixtureProject
  await prepareOpenSpecChange();

  await page.getByRole('button', { name: '工作流操作' }).click();
  const dialog = page.getByRole('dialog', { name: '工作流操作' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('select')).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(OPEN_SPEC_CHANGE_NAME) }).click();
  await page.getByRole('button', { name: '启动选中工作流' }).click();

  // Verify navigation to workflow detail page
  await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/playwright-run-[^/]+$`));
  await expect(page.getByTestId('workflow-role-summary')).toBeVisible();

  // Verify the fixed role rows are the primary workflow view and link to the child session.
  await expect(page.getByTestId('workflow-role-summary')).toContainText('规');
  await expect(page.getByTestId('workflow-role-summary')).toContainText('写');
  await expect(page.getByTestId('workflow-role-summary')).toContainText('审');
  await expect(page.getByTestId('workflow-stage-tree')).toHaveCount(0);
  await page.getByTestId('workflow-role-row-executor').getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/playwright-run-[^/]+/sessions/execution$`));
  await page.goto(`${projectRoutePrefix}/runs/${workflowIdFromUrl(page.url())}`);
  await expect(page.getByText(/Go runner: playwright-run-/)).toBeVisible();

  // Verify via API that the workflow is bound to the OpenSpec change
  const project = await getFixtureProject(page.context().request);
  const workflowMatch = page.url().match(/\/runs\/([^/]+)$/);
  const workflowId = workflowMatch ? workflowMatch[1] : '';

  const workflowResponse = await page.context().request.get(
    `/api/projects/${project.name}/workflows/${workflowId}`,
    { headers: authHeaders() },
  );
  expect(workflowResponse.ok()).toBe(true);
  const workflow = await workflowResponse.json();
  expect(workflow.openspecChangeName).toBe(OPEN_SPEC_CHANGE_NAME);
  expect(workflow.adoptsExistingOpenSpec).toBe(true);
  expect(workflow.openspecChangeDetected).toBe(true);
  expect(workflow.runner).toBe('go');
  expect(workflow.runnerProvider).toBe('codex');
  expect(workflow.runId).toMatch(/^playwright-run-/);
  expect(workflow.stageStatuses?.length || 0).toBeGreaterThan(0);
  expect(workflow.childSessions?.some((s) => s.provider === 'codex')).toBe(true);
  expect(workflow.runnerProcesses).toEqual([]);
});

test('starting two selected active changes shows two workflow entries', async ({ page }) => {
  test.setTimeout(90000);
  await openFixtureProject(page);
  await prepareOpenSpecChange('batch-change-a');
  await prepareOpenSpecChange('batch-change-b');

  await page.getByRole('button', { name: '工作流操作' }).click();
  await page.getByRole('button', { name: /batch-change-a/ }).click();
  await page.getByRole('button', { name: /batch-change-b/ }).click();
  await expect(page.getByText('已选 2')).toBeVisible();
  await page.getByRole('button', { name: '启动选中工作流' }).click();

  const results = page.getByTestId('workflow-launch-results');
  await expect(results).toContainText('batch-change-a');
  await expect(results).toContainText('batch-change-b');
  await expect(results).toContainText('已启动', { timeout: 60000 });
  await expect(results.getByRole('button', { name: '进入详情' })).toHaveCount(2, { timeout: 60000 });
});

test('batch launch keeps successful workflow result when another change fails', async ({ page }) => {
  test.setTimeout(90000);
  await openFixtureProject(page);
  await prepareOpenSpecChange('batch-success-change');
  await prepareOpenSpecChange('batch-fail-change');

  await page.route('**/api/projects/*/workflows', async (route) => {
    if (route.request().method() === 'POST' && route.request().postData()?.includes('batch-fail-change')) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'fixture oz flow failure' }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: '工作流操作' }).click();
  await page.getByRole('button', { name: /batch-success-change/ }).click();
  await page.getByRole('button', { name: /batch-fail-change/ }).click();
  await page.getByRole('button', { name: '启动选中工作流' }).click();

  const results = page.getByTestId('workflow-launch-results');
  await expect(results).toContainText('batch-success-change');
  await expect(results).toContainText('已启动', { timeout: 60000 });
  await expect(results).toContainText('batch-fail-change');
  await expect(results).toContainText('fixture oz flow failure');
  await expect(results.getByRole('button', { name: '进入详情' })).toHaveCount(1, { timeout: 60000 });
});

test('starting a new planning session does not create a oz flow run', async ({ page }) => {
  await openFixtureProject(page);
  const runsRoot = resolveFlowRunsRoot(PRIMARY_FIXTURE_PROJECT_PATH);
  let beforeRuns: string[] = [];
  try {
    beforeRuns = await fs.readdir(runsRoot);
  } catch {
    // Directory may not exist yet before first oz flow run
  }

  await page.getByRole('button', { name: '工作流操作' }).click();
  await page.getByRole('button', { name: '发起新的规划' }).click();

  await expect(page.getByRole('heading', { name: '新规划：oz change' })).toBeVisible();
  const composer = page.locator('textarea.chat-input-placeholder');
  await expect(composer).toContainText('先讨论问题、范围、非目标和测试策略');
  await expect(composer).toContainText('不要启动 oz flow sealed run');
  const afterRuns = await fs.readdir(runsRoot);
  expect(afterRuns.sort()).toEqual(beforeRuns.sort());
});

function workflowIdFromUrl(url) {
  /**
   * Recover the current workflow id after a child-session navigation.
   */
  return url.match(/\/runs\/([^/]+)/)?.[1] || '';
}
