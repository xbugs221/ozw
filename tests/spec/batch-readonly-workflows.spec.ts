/**
 * PURPOSE: Verify oz flow v1 batch workflow grouping stays read-only while child
 * runs remain navigable from the project overview.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { resolveFlowBatchesRoot, resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';
import { indexProviderSessionFile } from '../../backend/domains/projects/project-overview-service.ts';
import {
  authenticatePage,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import { ensurePlaywrightFixture, PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.ts';

type MultiItemBatchChange = {
  runId?: string;
  changeName: string;
  status: 'running' | 'completed' | 'pending';
};

async function writeBatchState() {
  /**
   * PURPOSE: Build the real oz flow v1 batch state shape where run_ids is a
   * change-name keyed object and current_index is zero-based.
   */
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  const batchDir = path.join(resolveFlowBatchesRoot(PRIMARY_FIXTURE_PROJECT_PATH), 'batch-fixture');
  await fs.mkdir(batchDir, { recursive: true });
  await fs.writeFile(path.join(batchDir, 'state.json'), `${JSON.stringify({
    batch_id: 'batch-fixture',
    status: 'running',
    current_index: 0,
    changes: ['登录升级'],
    run_ids: {
      '登录升级': 'run-fixture',
    },
    error: '',
  }, null, 2)}\n`, 'utf8');
}

async function writeBatchWorkflowFixture({
  batchId,
  runId,
  changeName,
  status,
  updatedAt,
}: {
  batchId: string;
  runId: string;
  changeName: string;
  status: 'running' | 'completed';
  updatedAt: string;
}) {
  /**
   * PURPOSE: Create real oz flow batch/run files so the project overview renders
   * the same read models a user sees for batch workflow history.
   */
  const batchDir = path.join(resolveFlowBatchesRoot(PRIMARY_FIXTURE_PROJECT_PATH), batchId);
  const runDir = path.join(resolveFlowRunsRoot(PRIMARY_FIXTURE_PROJECT_PATH), runId);
  await fs.mkdir(batchDir, { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(batchDir, 'state.json'), `${JSON.stringify({
    batch_id: batchId,
    status,
    current_index: status === 'completed' ? 1 : 0,
    changes: [changeName],
    run_ids: { [changeName]: runId },
    error: '',
    updated_at: updatedAt,
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    run_id: runId,
    change_name: changeName,
    status,
    stage: status === 'completed' ? 'archive' : 'review_1',
    updated_at: updatedAt,
    stages: status === 'completed'
      ? { execution: 'completed', review_1: 'completed', archive: 'completed' }
      : { execution: 'completed', review_1: 'running' },
    sessions: {},
    paths: {},
    error: '',
  }, null, 2)}\n`, 'utf8');
  if (status === 'completed') {
    await fs.writeFile(
      path.join(runDir, 'delivery-summary.md'),
      `# ${changeName} 交付汇报\n\n最后一步汇报文档来自真实 oz flow run 目录。\n`,
      'utf8',
    );
  }
}

async function writeMultiItemBatchWorkflowFixture({
  batchId,
  changes,
  updatedAt,
}: {
  batchId: string;
  changes: MultiItemBatchChange[];
  updatedAt: string;
}) {
  /**
   * PURPOSE: Create one real batch with multiple proposal rows so the homepage
   * can prove batched proposals are flattened instead of hidden behind a group.
   */
  const batchDir = path.join(resolveFlowBatchesRoot(PRIMARY_FIXTURE_PROJECT_PATH), batchId);
  await fs.mkdir(batchDir, { recursive: true });
  await fs.writeFile(path.join(batchDir, 'state.json'), `${JSON.stringify({
    batch_id: batchId,
    status: changes.some((change) => change.status === 'running') ? 'running' : 'completed',
    current_index: Math.max(changes.findIndex((change) => change.status === 'running'), 0),
    changes: changes.map((change) => change.changeName),
    run_ids: Object.fromEntries(changes
      .filter((change) => change.runId)
      .map((change) => [change.changeName, change.runId])),
    error: '',
    updated_at: updatedAt,
  }, null, 2)}\n`, 'utf8');

  await Promise.all(changes
    .filter((change): change is MultiItemBatchChange & { runId: string } => Boolean(change.runId))
    .map(async (change) => {
      const runDir = path.join(resolveFlowRunsRoot(PRIMARY_FIXTURE_PROJECT_PATH), change.runId);
      await fs.mkdir(runDir, { recursive: true });
      await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
        run_id: change.runId,
        change_name: change.changeName,
        status: change.status === 'pending' ? 'running' : change.status,
        stage: change.status === 'completed' ? 'archive' : 'execution',
        updated_at: updatedAt,
        stages: change.status === 'completed'
          ? { execution: 'completed', review_1: 'completed', archive: 'completed' }
          : { execution: 'running' },
        sessions: {},
        paths: {},
        error: '',
      }, null, 2)}\n`, 'utf8');
    }));
}

async function writeSessionsOnlyWorkflowState() {
  /**
   * PURPOSE: Model a workflow-owned session that is only present in oz flow
   * state.sessions, proving it is excluded from manual session lists.
   */
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  const runDir = path.join(resolveFlowRunsRoot(PRIMARY_FIXTURE_PROJECT_PATH), 'run-sessions-only');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    run_id: 'run-sessions-only',
    change_name: 'sessions-only-filter',
    status: 'running',
    stage: 'execution',
    stages: {
      execution: 'running',
    },
    sessions: {
      'codex:executor': 'fixture-project-manual-session',
    },
    paths: {},
    error: '',
  }, null, 2)}\n`, 'utf8');
}

async function writeCodexSubagentSession() {
  /**
   * PURPOSE: Seed the real Provider index with the Codex source structure that
   * previously escaped oz state-based workflow ownership filtering.
   */
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  const sessionId = 'codex-workflow-subagent-regression';
  const sessionDir = path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', '2026', '07', '14');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(sessionPath, `${[
    {
      type: 'session_meta',
      timestamp: '2031-07-14T02:00:00.000Z',
      payload: {
        id: sessionId,
        parent_thread_id: 'oz-flow-root-session',
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: 'oz-flow-root-session',
              depth: 1,
              agent_path: '/root/regression',
            },
          },
        },
        thread_source: 'subagent',
      },
    },
    {
      type: 'event_msg',
      timestamp: '2031-07-14T02:00:01.000Z',
      payload: {
        type: 'user_message',
        message: '不应显示的工作流派生子代理',
      },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
  await indexProviderSessionFile('codex', sessionPath);
}

test.describe('oz flow batch readonly workflows', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
  });

  test('batch group shows display progress and child run click opens detail', async ({ page }) => {
    await writeBatchState();
    await openFixtureProject(page, { reset: false });

    const batchGroup = page.getByTestId('batch-group-batch-fixture');
    await expect(batchGroup).toBeVisible();
    await expect(batchGroup.getByTestId('batch-header-batch-fixture')).toContainText('最新批量');
    await expect(batchGroup.getByTestId('batch-header-batch-fixture')).toContainText('b1');
    await expect(batchGroup.getByTestId('batch-header-batch-fixture')).toContainText('1/1');
    await expect(batchGroup.getByRole('button', { name: /登录升级/ })).toBeVisible();

    await batchGroup.getByRole('button', { name: /登录升级/ }).click();
    await expect(page).toHaveURL(/\/runs\/run-fixture$/);
    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();

    await page.getByTestId('workflow-status-tree-row-execution').getByRole('button', { name: 'SUMMARY.md' }).click();
    await expect(page.getByText('Workflow summary fixture')).toBeVisible();
  });

  test('overview defaults to the latest batch and flattens its proposals', async ({ page }) => {
    ensurePlaywrightFixture({ preserveAuthDatabase: true });
    await writeMultiItemBatchWorkflowFixture({
      batchId: 'batch-latest-flat-ui',
      updatedAt: '2031-05-26T10:00:00.000Z',
      changes: [
        { runId: 'run-latest-flat-208', changeName: '208-收敛后端安全债务', status: 'running' },
        { changeName: '209-压缩后端类型和巨型模块债', status: 'pending' },
        { runId: 'run-latest-flat-210', changeName: '210-建立聊天消息归并内核合同', status: 'completed' },
        { runId: 'run-latest-flat-211', changeName: '211-优化左侧导航活跃内容展示', status: 'completed' },
      ],
    });
    await writeBatchWorkflowFixture({
      batchId: 'batch-older-hidden-ui',
      runId: 'run-older-hidden-ui',
      changeName: '较早完成批次',
      status: 'completed',
      updatedAt: '2031-05-26T09:00:00.000Z',
    });

    await openFixtureProject(page, { reset: false });

    const workflowsPanel = page.getByTestId('project-overview-workflows');
    const latestBatch = workflowsPanel.getByTestId('batch-group-batch-latest-flat-ui');
    await expect(latestBatch).toBeVisible();
    await expect(workflowsPanel.getByTestId('batch-header-batch-latest-flat-ui')).toContainText('最新批量');
    await expect(workflowsPanel.getByTestId('batch-group-batch-older-hidden-ui')).toHaveCount(0);
    await expect(workflowsPanel).toContainText('查看历史工作流批次');
    await expect(workflowsPanel).not.toContainText('单独运行');
    await expect(workflowsPanel).not.toContainText('Codex');
    await expect(workflowsPanel).not.toContainText('运行中');

    await expect(latestBatch.getByRole('button', { name: /208-收敛后端安全债务/ })).toBeVisible();
    await expect(latestBatch.getByRole('button', { name: /209-压缩后端类型和巨型模块债/ })).toBeVisible();
    await expect(latestBatch.getByRole('button', { name: /210-建立聊天消息归并内核合同/ })).toBeVisible();
    await expect(latestBatch.getByRole('button', { name: /211-优化左侧导航活跃内容展示/ })).toBeVisible();
  });

  test('completed workflow archive row opens delivery summary from run directory', async ({ page }) => {
    /**
     * PURPOSE: Verify the user-visible final workflow report is linked even
     * when oz flow writes it as a run-directory artifact instead of state.paths.
     */
    ensurePlaywrightFixture({ preserveAuthDatabase: true });
    await writeBatchWorkflowFixture({
      batchId: 'batch-delivery-summary',
      runId: 'run-delivery-summary',
      changeName: '交付汇报链接',
      status: 'completed',
      updatedAt: '2029-05-26T11:00:00.000Z',
    });

    await openFixtureProject(page, { reset: false });
    const projectRoutePath = new URL(page.url()).pathname.replace(/\/+$/g, '');
    await page.goto(`${projectRoutePath}/runs/run-delivery-summary`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/runs\/run-delivery-summary$/);

    const archiveRow = page.getByTestId('workflow-status-tree-row-archive');
    await expect(archiveRow.getByRole('button', { name: 'delivery-summary.md' })).toBeVisible();
    await archiveRow.getByRole('button', { name: 'delivery-summary.md' }).click();
    await expect(page.getByText('最后一步汇报文档来自真实 oz flow run 目录。')).toBeVisible();
  });

  test('sidebar workflow group only keeps active batch attention rows', async ({ page }) => {
    ensurePlaywrightFixture({ preserveAuthDatabase: true });
    await writeBatchWorkflowFixture({
      batchId: 'batch-sidebar-active',
      runId: 'run-sidebar-active',
      changeName: '侧栏活跃运行标题',
      status: 'running',
      updatedAt: '2029-05-26T10:00:00.000Z',
    });
    await writeBatchWorkflowFixture({
      batchId: 'batch-sidebar-new',
      runId: 'run-sidebar-new',
      changeName: '侧栏最近完成运行标题',
      status: 'completed',
      updatedAt: '2029-05-26T09:00:00.000Z',
    });
    await writeBatchWorkflowFixture({
      batchId: 'batch-sidebar-mid',
      runId: 'run-sidebar-mid',
      changeName: '侧栏中间完成运行标题',
      status: 'completed',
      updatedAt: '2029-05-26T08:00:00.000Z',
    });
    await writeBatchWorkflowFixture({
      batchId: 'batch-sidebar-old',
      runId: 'run-sidebar-old',
      changeName: '侧栏较早完成运行标题',
      status: 'completed',
      updatedAt: '2029-05-26T07:00:00.000Z',
    });

    await openFixtureProject(page, { reset: false });

    await expect(page.getByTestId('project-workflow-group')).toHaveCount(0);
    const overviewWorkflows = page.getByTestId('project-overview-workflows');
    await expect(overviewWorkflows.getByTestId('batch-group-batch-sidebar-active')).toBeVisible();
    await expect(overviewWorkflows.getByTestId('batch-group-batch-sidebar-new')).toBeVisible();
    await expect(overviewWorkflows.getByTestId('batch-group-batch-sidebar-mid')).toBeVisible();
    await expect(overviewWorkflows.getByTestId('batch-group-batch-sidebar-old')).toBeVisible();
    await expect(overviewWorkflows).toContainText('批量');
    await expect(overviewWorkflows).toContainText('侧栏活跃运行标题');
  });

  test('sessions only present in oz flow state sessions are hidden from manual sessions', async ({ page }) => {
    await writeSessionsOnlyWorkflowState();
    await openFixtureProject(page, { reset: false });

    await expect(page.getByTestId('project-overview-manual-sessions')).not.toContainText(
      'fixture-project manual-only session',
    );
  });

  test('Codex JSONL subagents stay out of the manual session panel', async ({ page }) => {
    /**
     * PURPOSE: Verify the user-visible project overview consumes Provider
     * source classification even when oz flow state has no child session id.
     */
    await writeCodexSubagentSession();
    await openFixtureProject(page, { reset: false });

    const manualSessions = page.getByTestId('project-overview-manual-sessions');
    await expect(manualSessions).toBeVisible();
    await expect(manualSessions).not.toContainText('不应显示的工作流派生子代理');
    const screenshotPath = path.join(
      process.cwd(),
      'docs/debug/20260714-1032-flow-subagent-manual-session/screenshots/manual-sessions-filtered.png',
    );
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await manualSessions.screenshot({ path: screenshotPath });
  });
});
