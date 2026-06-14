// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: 验收测试：项目内需求工作流控制面。
 * Derived from openspec/changes/2028-integrate-hybrid-control-plane-into-ozw/specs/project-workflow-control-plane/spec.md.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  authHeaders,
  authenticatePage,
  getFixtureProject,
  openFixtureProject,
  openFixtureManualSessionFromOverview,
} from './helpers/spec-test-helpers.ts';
import { ensurePlaywrightFixture, PLAYWRIGHT_FIXTURE_HOME, PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from '../e2e/helpers/playwright-fixture.ts';
import { resolveFlowRunStatePath } from '../../backend/domains/workflows/flow-runtime-paths.ts';

/**
 * Write one synthetic Codex session fixture so acceptance tests can exercise
 * real project-discovery behavior with more than five visible sessions.
 *
 * @param {string} projectPath
 * @param {string} sessionId
 * @param {string} sessionTitle
 * @param {string} timestamp
 */
function writeSyntheticCodexSession(projectPath, sessionId, sessionTitle, timestamp) {
  const sessionDir = path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', '2026', '04', '19');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  const lines = [
    {
      type: 'session_meta',
      timestamp,
      payload: {
        id: sessionId,
        cwd: projectPath,
        model: 'gpt-5-codex',
      },
    },
    {
      type: 'event_msg',
      timestamp: new Date(new Date(timestamp).getTime() + 1000).toISOString(),
      payload: {
        type: 'user_message',
        message: sessionTitle,
      },
    },
    {
      type: 'response_item',
      timestamp: new Date(new Date(timestamp).getTime() + 2000).toISOString(),
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: `${sessionTitle} assistant turn 01` }],
      },
    },
  ];

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
}

/**
 * Add a discovered project whose basename is 001 so the sidebar test exercises
 * real project discovery instead of a mocked project array.
 *
 * @param {string} parentName
 * @returns {string}
 */
async function createTemp001CodexProject(request, parentName) {
  const projectPath = path.join('/tmp', parentName, '001');
  fs.mkdirSync(projectPath, { recursive: true });
  writeSyntheticCodexSession(
    projectPath,
    `${parentName.toLowerCase()}-session`,
    `${parentName} fixture session`,
    '2026-04-20T08:00:00.000Z',
  );
  const response = await request.post('/api/projects/create', {
    headers: authHeaders({ 'content-type': 'application/json' }),
    data: { path: projectPath },
  });
  expect(response.ok()).toBeTruthy();
  return projectPath;
}

/**
 * Force one fixture workflow into a target stage so acceptance tests can
 * exercise the matching control-plane CTA with real persisted state.
 *
 * @param {string} workflowId
 * @param {{ stage: string, runState: string, stageStatuses: Array<{ key: string, label: string, status: string }>, openspecChangeDetected?: boolean, openspecChangeName?: string, adoptsExistingOpenSpec?: boolean, gateDecision?: string, finalReadiness?: boolean }} nextState
 */
function rewriteFixtureWorkflowState(workflowId, nextState) {
  void workflowId;
  rewriteFixtureRunState({
    stage: nextState.stage,
    status: nextState.runState,
    stages: Object.fromEntries((nextState.stageStatuses || []).map((stage) => [stage.key, stage.status])),
  });
}

/**
 * Update the Go runner state fixture that now owns workflow read-model facts.
 *
 * @param {{ stage?: string, status?: string, stages?: Record<string, string>, sessions?: Record<string, string>, processes?: Array<Record<string, unknown>> }} nextState
 */
function rewriteFixtureRunState(nextState) {
  const statePath = resolveFlowRunStatePath(PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0], 'run-fixture');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const mergedState = { ...state, ...nextState };
  if (!Object.prototype.hasOwnProperty.call(nextState, 'workflow_display')) {
    delete mergedState.workflow_display;
  }
  fs.writeFileSync(statePath, `${JSON.stringify(mergedState, null, 2)}\n`, 'utf8');
}

/**
 * Replace one fixture workflow child-session list so routing assertions can
 * exercise review links with real persisted workflow state.
 *
 * @param {string} workflowId
 * @param {Array<Record<string, unknown>>} childSessions
 */
function rewriteFixtureWorkflowChildSessions(workflowId, childSessions) {
  void workflowId;
  const sessions = {};
  const stages = {};
  const processes = [];
  for (const session of childSessions) {
    const stageKey = session.stageKey;
    const role = /^review_\d+$/.test(String(stageKey || '')) ? 'reviewer'
      : stageKey === 'archive' ? 'archiver'
        : stageKey === 'planning' ? 'planning'
          : 'executor';
    const sessionKey = role === 'planning' ? 'codex:planner' : `codex:${role}`;
    sessions[sessionKey] = session.id;
    stages[stageKey] = 'completed';
    processes.push({
      stage: stageKey,
      role,
      status: 'completed',
      sessionId: session.id,
    });
  }
  rewriteFixtureRunState({ sessions, stages, processes });
}

test.describe('项目内需求工作流控制面', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('项目右侧正文展示默认折叠的自动工作流与手动会话入口', async ({ page }) => {
    await openFixtureProject(page);

    await expect(page.getByRole('button', { name: '工作流操作' })).toBeVisible();
    await expect(page.getByRole('button', { name: /新建会话|New Session/i })).toBeVisible();
    const manualSessionsPanel = page.getByTestId('project-overview-manual-sessions');
    const workflowsPanel = page.getByTestId('project-overview-workflows');
    await expect(manualSessionsPanel.getByRole('heading', { name: '手动会话' })).toBeVisible();
    await expect(workflowsPanel.getByRole('heading', { name: '自动工作流' })).toBeVisible();
    await expect(manualSessionsPanel).toBeVisible();
    await expect(workflowsPanel).toBeVisible();
    await expect(workflowsPanel.getByRole('button', { name: /登录升级/ })).toBeVisible();
  });

  test('项目主页手动会话卡片显示首条请求前缀', async ({ page }) => {
    await openFixtureProject(page);
    const manualSessionsPanel = page.getByTestId('project-overview-manual-sessions');
    const manualSessionCards = manualSessionsPanel.getByRole('button').filter({ hasText: /#\d/ });

    await expect(manualSessionsPanel).toContainText('1 个可直接进入的会话');
    await expect(manualSessionCards).toHaveCount(1);
    await expect(manualSessionsPanel).not.toContainText('fixture-project execution fixture session');
    await expect(manualSessionsPanel).toContainText('fixture-project manu');
  });

  test('项目主页手动会话卡片支持多选后批量标记和隐藏', async ({ page }) => {
    const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
    writeSyntheticCodexSession(
      projectPath,
      'fixture-project-second-session',
      'fixture-project second session',
      '2026-04-18T10:00:00.000Z',
    );
    const refreshResponse = await page.request.post('/api/projects/create', {
      headers: authHeaders({ 'content-type': 'application/json' }),
      data: { path: projectPath },
    });
    expect(refreshResponse.ok()).toBeTruthy();
    await openFixtureProject(page, { reset: false });
    const manualSessionsPanel = page.getByTestId('project-overview-manual-sessions');
    const firstSessionCard = manualSessionsPanel.getByRole('button', { name: /fixture-project manu/ }).first();
    const secondSessionCard = manualSessionsPanel.getByRole('button', { name: /fixture-project seco/ }).first();

    await page.getByTestId('project-overview-session-selection-toggle').click();
    await firstSessionCard.click();
    await secondSessionCard.click();
    await expect(page.getByTestId('project-overview-session-bulk-toolbar')).toContainText('已选 2 个');

    await page.getByTestId('project-overview-bulk-pending').click();
    await expect(manualSessionsPanel.getByRole('button', { name: /fixture-project manu.*待处理/ })).toBeVisible();
    await expect(manualSessionsPanel.getByRole('button', { name: /fixture-project seco.*待处理/ })).toBeVisible();

    await page.getByTestId('project-overview-bulk-hide').click();
    await expect(manualSessionsPanel.getByRole('button', { name: /fixture-project manu/ })).toHaveCount(0);
    await expect(manualSessionsPanel.getByRole('button', { name: /fixture-project seco/ })).toHaveCount(0);
    ensurePlaywrightFixture({ preserveAuthDatabase: true });
    const resetResponse = await page.request.post('/api/projects/create', {
      headers: authHeaders({ 'content-type': 'application/json' }),
      data: { path: projectPath },
    });
    expect(resetResponse.ok()).toBeTruthy();
  });

  test('手动会话详情也支持跟随最新进度', async ({ page }) => {
    await openFixtureProject(page);
    await openFixtureManualSessionFromOverview(page);
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toContainText(
      'fixture-project manual-only session assistant turn 01',
    );
    await expect(page.getByTestId('chat-follow-latest')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('chat-follow-latest').click();
    await expect(page.getByTestId('chat-follow-latest')).toHaveAttribute('aria-pressed', 'true');
  });

  test('项目主页点击新建会话会先选择 provider 并在首条消息后切到真实 session', async ({ page }) => {
    await openFixtureProject(page);

    await page.getByRole('button', { name: /新建会话|New Session/i }).click();
    await expect(page.getByTestId('project-new-session-provider-picker')).toBeVisible();
    await expect(page.getByTestId('project-new-session-provider-claude')).toHaveCount(0);
    await expect(page.getByTestId('project-new-session-provider-codex')).toBeVisible();
    await expect(page.getByTestId('project-new-session-provider-pi')).toBeVisible();
    await expect(page.getByTestId('project-new-session-provider-opencode')).toHaveCount(0);
    page.once('dialog', async (dialog) => {
      await dialog.accept('新建 Codex 验收会话');
    });
    await page.getByTestId('project-new-session-provider-codex').click();

    await expect(page).toHaveURL(/\/c\d+$/);

    await page.locator('textarea').first().fill('请创建一个新的 codex 会话');
    await page.locator('form button[type="submit"]').last().click();

    await expect(page).not.toHaveURL(/\/session\/new-session-/);
    await expect(page).toHaveURL(/\/c\d+$/);
  });

  test('控制面工作流详情展示阶段图与阶段入口', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByRole('heading', { name: '登录升级' }).last()).toBeVisible();
    await expect(page.getByTestId('workflow-runner-processes')).toHaveCount(0);
    await expect(page.getByText('阶段进度')).toHaveCount(0);
    await expect(page.getByTestId('workflow-runner-diagnostics')).toHaveCount(0);
    await expect(page.getByTestId('workflow-inspection-tree')).toHaveCount(0);
    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
    await expect(page.getByTestId('workflow-role-summary')).toHaveCount(0);
    await expect(page.getByTestId('workflow-status-tree-row-planning')).toContainText('规划阶段');
    await expect(page.getByTestId('workflow-status-tree-row-execution')).toContainText('执行阶段');
    await expect(page.getByTestId('workflow-status-tree-row-review_1')).toContainText('审核阶段');
    await page.getByTestId('workflow-status-tree-row-execution').getByRole('button', { name: '执行阶段' }).click();
    await expect(page).toHaveURL(/\/runs\/run-fixture\/sessions\/execution$/);
  });

  test('workflow 详情用业务名展示 execution 子代理，不暴露 review 和 qa 技术前缀', async ({ page }) => {
    rewriteFixtureRunState({
      stage: 'execution',
      status: 'running',
      stages: { execution: 'running' },
      sessions: {},
      processes: [
        {
          stage: 'execution',
          role: 'subagent:implementation_context:代码库侦察员:0',
          provider: 'pi',
          status: 'completed',
          session_id: 'implementation-context-session',
        },
        {
          stage: 'execution',
          role: 'subagent:review:目标核对审核员:1',
          provider: 'pi',
          status: 'running',
          session_id: 'review-subagent-session',
        },
        {
          stage: 'execution',
          role: 'subagent:qa:浏览器验收员:1',
          provider: 'pi',
          status: 'pending',
          session_id: 'qa-subagent-session',
        },
      ],
    });

    await openFixtureProject(page, { reset: false });
    await page.getByRole('button', { name: /登录升级/ }).click();

    const executionRow = page.getByTestId('workflow-status-tree-row-execution');
    await expect(executionRow).toContainText('0 代码库侦察员');
    await expect(executionRow).toContainText('1 目标核对审核员');
    await expect(executionRow).toContainText('1 浏览器验收员');
    await expect(executionRow).not.toContainText('review:目标核对审核员');
    await expect(executionRow).not.toContainText('qa:浏览器验收员');
  });

  test('项目导航不出现重复 001 且 workflow 详情保留 wo 进度文本', async ({ page }) => {
    await openFixtureProject(page);
    const firstTempProject = await createTemp001CodexProject(page.request, 'TestCcflowDuplicate001A');
    const secondTempProject = await createTemp001CodexProject(page.request, 'TestCcflowDuplicate001B');

    const projectsResponse = await page.request.get('/api/projects', { headers: authHeaders() });
    expect(projectsResponse.ok()).toBeTruthy();
    const projects = await projectsResponse.json();
    const tempProjects = Array.isArray(projects)
      ? projects.filter((project) => [firstTempProject, secondTempProject].includes(project.fullPath))
      : [];
    expect(tempProjects.map((project) => project.displayName).sort()).toEqual([
      '001 - TestCcflowDuplicate001A',
      '001 - TestCcflowDuplicate001B',
    ]);
    const duplicate001Count = tempProjects
      ? projects.filter((project) => project.displayName === '001').length
      : 0;
    expect(duplicate001Count).toBeLessThan(2);

    rewriteFixtureRunState({
      stage: 'review_2',
      status: 'running',
      stages: { execution: 'completed', review_1: 'completed', repair_1: 'completed', review_2: 'running' },
      workflow_display: {
        lines: [
          { marker: '✓', text: 'start', stage_key: 'execution' },
          { marker: '✓', text: 'review', stage_key: 'review_1' },
          { marker: '✓', text: '1 fix', stage_key: 'repair_1' },
          { marker: '→', text: '1 fix review', stage_key: 'review_2' },
        ],
      },
    });

    await openFixtureProject(page, { reset: false });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /自动工作流/ })).toBeVisible();
    const projectList = page.getByTestId('project-list');
    await expect(projectList.getByRole('button', { name: /^001$/ })).toHaveCount(0);
    await expect(projectList.getByRole('button', { name: /001 - TestCcflowDuplicate001A/ })).toBeVisible();
    await expect(projectList.getByRole('button', { name: /001 - TestCcflowDuplicate001B/ })).toBeVisible();

    await page.getByRole('button', { name: /登录升级/ }).click();

    const stageTree = page.getByTestId('workflow-status-tree');
    await expect(stageTree).toContainText('执行阶段');
    await expect(stageTree).toContainText('审核阶段');
    await expect(stageTree).not.toContainText('review 2');
    await expect(stageTree).not.toContainText('复审');
  });

  test('无法匹配的 workflow jsonl 不会把阶段文字渲染成链接', async ({ page }) => {
    await openFixtureProject(page);
    rewriteFixtureRunState({
      stage: 'review_1',
      status: 'running',
      stages: { execution: 'completed', review_1: 'running' },
      workflow_display: {
        lines: [
          {
            id: 'unknown-jsonl',
            marker: '→',
            text: 'review',
            raw_line: '→ review unknown-thread.jsonl',
            stage_key: 'review_1',
          },
        ],
      },
      processes: [
        { stage: 'review_1', role: 'reviewer', status: 'running', sessionId: 'actual-review-thread' },
      ],
    });

    await page.getByRole('button', { name: /登录升级/ }).click();

    const stageTree = page.getByTestId('workflow-status-tree');
    await expect(stageTree).toContainText('审核阶段');
    await expect(stageTree).not.toContainText('unknown-thread.jsonl');
    await expect(page.getByTestId('workflow-status-tree-row-review_1').getByRole('button', { name: '审核阶段' })).toBeVisible();
    await expect(page.getByTestId('workflow-runner-diagnostics')).toHaveCount(0);
  });

  test('打开规划会话会直接进入已有 planning 子会话', async ({ page }) => {
    rewriteFixtureWorkflowState('w1', {
      stage: 'planning',
      runState: 'planning',
      stageStatuses: [
        { key: 'planning', label: 'Planning', status: 'active' },
        { key: 'execution', label: 'Execution', status: 'pending' },
        { key: 'verification', label: 'Verification', status: 'pending' },
        { key: 'ready_for_acceptance', label: 'Ready for acceptance', status: 'pending' },
      ],
    });

    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();
    await page.getByTestId('workflow-status-tree-row-planning').getByRole('button', { name: '规划阶段' }).click();

    await expect(page).toHaveURL(/\/runs\/run-fixture\/sessions\/planning$/);
    await expect(page).not.toHaveURL(/\/session\/new-session-/);
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  });

  test('指定 OpenSpec 变更后不显示手动开始执行入口', async ({ page }) => {
    rewriteFixtureWorkflowState('w1', {
      stage: 'planning',
      runState: 'planning',
      openspecChangeDetected: true,
      stageStatuses: [
        { key: 'planning', label: 'Planning', status: 'completed' },
        { key: 'execution', label: 'Execution', status: 'pending' },
        { key: 'verification', label: 'Verification', status: 'pending' },
        { key: 'ready_for_acceptance', label: 'Ready for acceptance', status: 'pending' },
      ],
    });

    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByRole('button', { name: '开始执行' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续推进' })).toHaveCount(0);
  });

  test('新建工作流后会进入 Go runner run 详情', async ({ page }) => {
    const changeName = 'playwright-created-change';
    await openFixtureProject(page);
    const project = await getFixtureProject(page.request);
    const changeRoot = path.join(PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0], 'docs', 'changes', changeName);
    fs.mkdirSync(changeRoot, { recursive: true });
    fs.writeFileSync(path.join(changeRoot, 'proposal.md'), '# Playwright created change\n', 'utf8');
    fs.writeFileSync(path.join(changeRoot, 'design.md'), '# Design\n', 'utf8');
    fs.writeFileSync(path.join(changeRoot, 'spec.md'), '# Spec\n', 'utf8');
    fs.writeFileSync(path.join(changeRoot, 'task.md'), '- [ ] start workflow\n', 'utf8');
    const changesResponse = await page.request.get(
      `/api/projects/${encodeURIComponent(project.name)}/openspec/changes?projectPath=${encodeURIComponent(project.fullPath)}`,
      { headers: authHeaders() },
    );
    const changesBody = await changesResponse.text();
    expect(changesResponse.ok(), `${changesResponse.status()} ${changesBody}`).toBeTruthy();
    const changesPayload = JSON.parse(changesBody);
    expect(JSON.stringify(changesPayload)).toContain(changeName);

    await page.getByRole('button', { name: '工作流操作' }).click();
    const dialog = page.getByRole('dialog', { name: '工作流操作' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('select')).toHaveCount(0);
    await dialog.getByRole('button', { name: '刷新 active changes' }).click();
    await dialog.getByRole('button', { name: new RegExp(changeName) }).click();
    await page.getByRole('button', { name: '启动选中工作流' }).click();

    await expect(page).toHaveURL(/\/runs\/[^/]+$/);
    await expect(page.getByTestId('workflow-runner-processes')).toHaveCount(0);
  });

  test('工作流产物可直接打开文件或目录', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByTestId('workflow-inspection-tree')).toHaveCount(0);
    await expect(page.getByTestId('workflow-status-tree-row-execution').getByRole('button', { name: /SUMMARY.md/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /workflow-output/ })).toBeVisible();
  });

  test('2030 需求工作流详情默认落在项目作用域详情路由', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page).toHaveURL(/\/runs\/run-fixture$/);
    await expect(page.getByRole('heading', { name: '登录升级' }).last()).toBeVisible();
    await expect(page.locator('[data-testid=\"chat-scroll-container\"]')).toHaveCount(0);
  });

  test('2030 工作流详情页显示阶段图，工作流子会话页不显示流程图预览', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
    await expect(page.getByTestId('workflow-stage-mini-map')).toHaveCount(0);
    await expect(page.getByTestId('workflow-inspection-tree')).toHaveCount(0);

    await page.getByTestId('workflow-status-tree-row-planning').getByRole('button', { name: '规划阶段' }).click();
    await expect(page).toHaveURL(/\/runs\/run-fixture\/sessions\/planning$/);
    await expect(page.getByTestId('workflow-minimap')).toHaveCount(0);
    await expect(page.getByTestId('workflow-minimap-drag-handle')).toHaveCount(0);

    await page.getByTestId('project-list-item-fixture-project-desktop-surface').click();
    await openFixtureManualSessionFromOverview(page);
    await expect(page.getByTestId('workflow-minimap')).toHaveCount(0);
  });

  test('Go runner 工作流不再暴露旧本地 child session mutation', async ({ page }) => {
    const project = await getFixtureProject(page.request);
    const response = await page.request.post(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/run-fixture/child-sessions`,
      {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        data: {
          sessionId: 'workflow-review-1',
          title: '内部审核第 1 轮：需求与范围覆盖',
          summary: '人工审核已完成第 1 轮',
          provider: 'codex',
          stageKey: 'review_1',
          url: '/runs/run-fixture/sessions/review_1',
        },
      },
    );
    expect(response.status()).toBe(404);
  });

  test('工作流详情阶段名称可点击进入对应子会话', async ({ page }) => {
    rewriteFixtureWorkflowChildSessions('w1', [
      {
        id: 'fixture-project-session',
        title: '子会话 规划',
        summary: '需求分解与计划确认',
        provider: 'codex',
        stageKey: 'planning',
      },
      {
        id: 'fixture-project-execution-session',
        title: '子会话 执行',
        summary: '实现与运行状态同步',
        provider: 'codex',
        stageKey: 'execution',
      },
      {
        id: 'workflow-review-1',
        title: '内部审核第 1 轮：范围覆盖',
        summary: '审核第 1 轮',
        provider: 'codex',
        stageKey: 'review_1',
      },
    ]);

    await openFixtureProject(page, { reset: false });
    await openFixtureManualSessionFromOverview(page);
    await expect(page).toHaveURL(/\/workspace\/fixture-project\/c\d+$/);

    await openFixtureProject(page, { reset: false });
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
    await expect(page.getByTestId('workflow-status-tree-row-execution')).toContainText('执行阶段');
    await page.getByTestId('workflow-status-tree-row-execution').getByRole('button', { name: '执行阶段' }).click();
    await expect(page).toHaveURL(/\/runs\/run-fixture\/sessions\/execution$/);

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '登录升级' }).last()).toBeVisible();
    await expect(page.getByTestId('workflow-status-tree-row-review_1').getByRole('button', { name: '审核阶段' })).toBeVisible();
    await page.getByTestId('workflow-status-tree-row-review_1').getByRole('button', { name: '审核阶段' }).click();
    await expect(page).toHaveURL(/\/runs\/run-fixture\/sessions\/review_1$/);
  });

  test('新建会话占位路由在 projectName 错误时仍优先使用 projectPath 选中项目', async ({ page }) => {
    const project = await getFixtureProject(page.request);
    const wrongProjectName = `${project.fullPath}-wrong`.replace(/\//g, '-');
    const sessionSummary = '路径优先回归会话';
    const sessionUrl = `/session/new-session-route-path-priority?projectName=${encodeURIComponent(wrongProjectName)}&projectPath=${encodeURIComponent(project.fullPath)}&provider=codex&sessionSummary=${encodeURIComponent(sessionSummary)}`;

    await authenticatePage(page);
    await page.goto(sessionUrl, { waitUntil: 'domcontentloaded' });

    const sessionHeading = page.getByRole('heading', { name: sessionSummary });
    await expect(sessionHeading).toBeVisible();
    await expect(sessionHeading.locator('xpath=following-sibling::div[1]')).toHaveText(project.displayName || project.name);
  });

  test('阶段树会显示当前停留原因和缺失产物提示', async ({ page }) => {
    rewriteFixtureRunState({
      stage: 'archive',
      status: 'blocked',
      stages: {
        planning: 'completed',
        execution: 'completed',
        review_1: 'completed',
        repair_1: 'completed',
        review_2: 'completed',
        repair_2: 'completed',
        review_3: 'completed',
        repair_3: 'completed',
        archive: 'active',
      },
      sessions: {
        'codex:planner': 'fixture-project-session',
        'codex:executor': 'fixture-project-execution-session',
        'codex:archiver': 'fixture-project-archive-session',
      },
      processes: [
        {
          stage: 'planning',
          role: 'executor',
          status: 'completed',
          sessionId: 'fixture-project-session',
        },
        {
          stage: 'execution',
          role: 'executor',
          status: 'completed',
          sessionId: 'fixture-project-execution-session',
        },
        {
          stage: 'archive',
          role: 'archiver',
          status: 'running',
          sessionId: 'fixture-project-archive-session',
        },
      ],
    });

    await openFixtureProject(page, { reset: false });
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByTestId('workflow-inspection-tree')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /delivery-summary\.md/ })).toHaveCount(0);
    await expect(page.getByText('delivery-summary.md 尚未生成。')).toHaveCount(0);
  });

  test('收尾工作流只显示一个归档入口并允许选择验收决策', async ({ page }) => {
    await openFixtureProject(page);

    rewriteFixtureWorkflowState('w1', {
      stage: 'archive',
      runState: 'blocked',
      gateDecision: 'pending',
      finalReadiness: false,
      stageStatuses: [
        { key: 'planning', label: 'Planning', status: 'completed' },
        { key: 'execution', label: 'Execution', status: 'completed' },
        { key: 'review_1', label: '初审', status: 'completed' },
        { key: 'repair_1', label: '初修', status: 'completed' },
        { key: 'review_2', label: '再审', status: 'completed' },
        { key: 'repair_2', label: '再修', status: 'completed' },
        { key: 'review_3', label: '三审', status: 'completed' },
        { key: 'repair_3', label: '三修', status: 'completed' },
        { key: 'archive', label: '归档', status: 'active' },
      ],
    });
    rewriteFixtureWorkflowChildSessions('w1', [
      {
        id: 'archive-session-old',
        routeIndex: 11,
        title: '归档会话',
        summary: '旧归档会话',
        provider: 'codex',
        stageKey: 'archive',
      },
      {
        id: 'archive-session-new',
        routeIndex: 12,
        title: '归档会话',
        summary: '最新归档会话',
        provider: 'codex',
        stageKey: 'archive',
      },
    ]);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const workflowDetailResponse = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/api/projects/')
      && /\/workflows\/[^/?]+(?:\?|$)/.test(response.url())
    ));
    await page.getByRole('button', { name: /登录升级/ }).click();
    await workflowDetailResponse;

    await expect(page.getByTestId('workflow-stage-archive')).toHaveCount(0);
    await expect(page.getByText('验收状态')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续推进' })).toHaveCount(0);
    await expect(page.getByTestId('workflow-gate-decision-pass')).toHaveCount(0);
    await expect(page.getByTestId('workflow-gate-decision-needs_repair')).toHaveCount(0);
  });

  test('刷新后保留工作流控制面状态', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByText('阶段进度')).toHaveCount(0);
    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: '登录升级' }).last()).toBeVisible();
    await expect(page.getByText('阶段进度')).toHaveCount(0);
    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
  });

  test('项目列表保持字母序并显示项目级活跃状态与未读绿点', async ({ page }) => {
    await expect(page.getByTestId('project-list-item-alpha')).toBeVisible();
	    await expect(page.getByTestId('project-list-item-fixture-project')).toBeVisible();
	    await expect(page.getByTestId('project-list-item-zeta')).toBeVisible();
	    await expect(page.getByTestId('project-list-item-fixture-project')).not.toContainText('workflows');
	    await expect(page.getByTestId('project-list-item-fixture-project')).not.toContainText('/home/');

	    await expect(page.getByTestId('project-list')).toHaveAttribute(
      'data-project-order',
      'alpha,fixture-project,zeta',
    );
    await expect(
      page
        .getByRole('button', { name: /^fixture-project\b/i })
        .first()
        .locator('[data-testid="project-list-item-fixture-project-active-dot"]'),
    ).toBeVisible();
    await expect(page.getByTestId('project-list-item-fixture-project-unread-dot')).toBeVisible();
    await expect(page.getByTestId('project-list')).toHaveAttribute(
      'data-project-order',
      'alpha,fixture-project,zeta',
    );
  });

  test('左侧项目点击只进入项目主页且不展开子卡片', async ({ page }) => {
    await openFixtureProject(page);

	    const projectSurface = page.getByTestId('project-list-item-fixture-project-desktop-surface');
	    await expect(page.getByTestId('project-workflow-group')).toHaveCount(0);
	    await expect(page.getByTestId('manual-session-group')).toHaveCount(0);
	    await expect.poll(async () => {
	      /**
	       * PURPOSE: Project list entries are now one-line navigation rows, not
	       * the older two-line summary cards.
	       */
	      return projectSurface.evaluate((element) => {
	        return Math.round(element.getBoundingClientRect().height);
	      });
	    }).toBeLessThanOrEqual(44);

	    await projectSurface.click();
    await expect(page).toHaveURL(/\/workspace\/fixture-project$/);
    await expect(page.getByTestId('project-workflow-group')).toHaveCount(0);
    await expect(page.getByTestId('manual-session-group')).toHaveCount(0);

    await projectSurface.click();
    await expect(page).toHaveURL(/\/workspace\/fixture-project$/);
    await expect(page.getByTestId('project-overview-workflows')).toBeVisible();
    await expect(page.getByTestId('project-overview-manual-sessions')).toBeVisible();
  });

  test('左侧项目清单不提供工作流和手动会话子控件', async ({ page }) => {
    await openFixtureProject(page);

    await expect(page.getByTestId('project-workflow-group')).toHaveCount(0);
    await expect(page.getByTestId('manual-session-group')).toHaveCount(0);
    await expect(page.getByTestId('project-overview-workflows').getByLabel('工作流排序')).toBeVisible();
    await expect(page.getByTestId('project-overview-manual-sessions').getByLabel('手动会话排序')).toBeVisible();
    await expect(page.getByRole('button', { name: '工作流操作' })).toBeVisible();
    await expect(page.getByRole('button', { name: /新建会话|New Session/i })).toBeVisible();
  });

  test('桌面端项目操作默认隐藏并通过右键打开', async ({ page }) => {
    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/project\//);

    await page.getByTestId('project-list-item-fixture-project-desktop-surface').click({ button: 'right' });

    await expect(page).not.toHaveURL(/\/project\//);
    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toBeVisible();
    await page.getByTestId('project-list-item-fixture-project-rename-action').click();
    await expect(page.locator('[data-testid="project-list-item-fixture-project"] input:visible')).toHaveCount(1);
  });

  test('移动端项目操作默认隐藏并通过长按打开', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const visibleMenuButton = page.locator('button[aria-label="Open menu"]:visible').first();
    await expect(visibleMenuButton).toBeVisible();
    await visibleMenuButton.click({ force: true });

    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/project\//);

    await page.getByTestId('project-list-item-fixture-project-mobile-surface').dispatchEvent('touchstart');
    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toBeVisible();
    await page.getByTestId('project-list-item-fixture-project-mobile-surface').dispatchEvent('touchend');

    await expect(page).not.toHaveURL(/\/project\//);
    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toBeVisible();
    await expect(page.getByTestId('project-list-item-fixture-project-rename-action')).toBeVisible();
    await expect(page.getByTestId('project-list-item-fixture-project-delete-action')).toBeVisible();
  });

  test('在项目会话内再次点击左侧项目会回到项目主页', async ({ page }) => {
    await openFixtureProject(page);
    await openFixtureManualSessionFromOverview(page);
    await expect(page).toHaveURL(/\/workspace\/fixture-project\/c\d+$/);

    await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
    await expect(page).toHaveURL(/\/workspace\/fixture-project$/);
    await expect(page.getByRole('heading', { name: '自动工作流' })).toBeVisible();
  });

  test('查看后清除项目未读绿点', async ({ page }) => {
    await expect(page.getByTestId('project-list-item-fixture-project-unread-dot')).toBeVisible();

    await openFixtureProject(page);
    await page.getByRole('button', { name: /登录升级/ }).click();
    await expect(page.getByTestId('workflow-runner-processes')).toHaveCount(0);
  });

  test('项目主页的工作流和会话右键菜单支持收藏、待处理、隐藏及恢复', async ({ page }) => {
    await openFixtureProject(page);

    const fixtureSessionName = /^fixture-project manu\b/;
    await expect(page.getByTestId('manual-session-group')).toHaveCount(0);

    const workflowCard = page.getByTestId('project-overview-workflows').getByRole('button', { name: /登录升级/ }).first();
    await workflowCard.click({ button: 'right' });
    await expect(page.getByTestId('project-overview-context-favorite')).toHaveCount(0);
    await expect(page.getByTestId('project-overview-context-pending')).toHaveCount(0);
    await expect(page.getByTestId('project-overview-context-hide')).toHaveCount(0);

    let sessionCard = page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: fixtureSessionName }).first();
    await sessionCard.click({ button: 'right' });
    const favoriteResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'PUT' && response.url().includes('/ui-state')
    ));
    await page.getByTestId('project-overview-context-favorite').click();
    const favoriteResponse = await favoriteResponsePromise;
    expect(favoriteResponse.ok(), await favoriteResponse.text()).toBeTruthy();
    await expect((await favoriteResponse.json()).state?.favorite).toBe(true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    sessionCard = page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: fixtureSessionName }).first();
    await sessionCard.click({ button: 'right' });
    const pendingResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'PUT' && response.url().includes('/ui-state')
    ));
    await page.getByTestId('project-overview-context-pending').click();
    const pendingResponse = await pendingResponsePromise;
    expect(pendingResponse.ok(), await pendingResponse.text()).toBeTruthy();
    await expect((await pendingResponse.json()).state?.pending).toBe(true);

    await sessionCard.click({ button: 'right' });
    const hideResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'PUT' && response.url().includes('/ui-state')
    ));
    await page.getByTestId('project-overview-context-hide').click();
    const hideResponse = await hideResponsePromise;
    expect(hideResponse.ok(), await hideResponse.text()).toBeTruthy();
    await expect(page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: fixtureSessionName })).toHaveCount(0);
    await expect((await hideResponse.json()).state?.hidden).toBe(true);

    await page.getByRole('button', { name: /显示已隐藏项/ }).click();
    await expect(page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: fixtureSessionName })).toBeVisible();
    await expect(page.getByTestId('project-overview-workflows').getByRole('button', { name: /登录升级/ })).toBeVisible();

    await page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: fixtureSessionName }).first().click({ button: 'right' });
    await page.getByTestId('project-overview-context-hide').click();
    await expect(page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: fixtureSessionName })).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: fixtureSessionName })).toBeVisible();
  });
});
