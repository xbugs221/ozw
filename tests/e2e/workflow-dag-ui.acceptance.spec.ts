// @ts-nocheck -- 创建阶段浏览器契约测试：执行阶段负责与最终 UI 类型对齐。
/**
 * PURPOSE: Verify the real ozw workflow detail page absorbs former DAG review
 * targets into the oz flow status tree for child-session and artifact inspection.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveFlowRunStatePath } from '../../backend/domains/workflows/flow-runtime-paths.ts';
import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
  writeWorkspaceTextFile,
} from '../spec/helpers/spec-test-helpers.ts';

const CHANGE_NAME = '90-DAG审查页浏览器fixture';
const RUN_ID = 'run-dag-review-ui';

/**
 * Write a real wo state fixture and artifacts into the Playwright workspace.
 */
async function writeWorkflowDagUiFixture() {
  const statePath = resolveFlowRunStatePath(PRIMARY_FIXTURE_PROJECT_PATH, RUN_ID);
  const runRoot = path.dirname(statePath);
  await fs.mkdir(runRoot, { recursive: true });

  await writeWorkspaceTextFile(`docs/changes/${CHANGE_NAME}/proposal.md`, '# DAG 审查页浏览器 fixture\n');
  await writeWorkspaceTextFile(`docs/changes/${CHANGE_NAME}/design.md`, '# Design\n');
  await writeWorkspaceTextFile(`docs/changes/${CHANGE_NAME}/spec.md`, '# Spec\n');
  await writeWorkspaceTextFile(`docs/changes/${CHANGE_NAME}/task.md`, '# Task\n');

  await fs.writeFile(path.join(runRoot, 'parallel-planning_context.json'), '{"summary":"planning fan-in"}\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'parallel-review-1.json'), '{"summary":"review fan-in"}\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'review-1.json'), '{"decision":"clean","findings":[]}\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'qa-1.json'), '{"decision":"needs_fix","evidence":["browser path"]}\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'fix-1-summary.md'), '# Fix\n\nBrowser path fixed.\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'delivery-summary.md'), '# Delivery\n\nReady for review.\n', 'utf8');

  await fs.writeFile(
    statePath,
    `${JSON.stringify({
      run_id: RUN_ID,
      change_name: CHANGE_NAME,
      sealed: true,
      status: 'running',
      stage: 'qa_1',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        qa_1: 'running',
        fix_1: 'pending',
        archive: 'pending',
      },
      sessions: {
        'codex:planner': 'planner-session-ui',
        'codex:executor': 'execution-session-ui',
        'codex:reviewer': 'review-session-ui',
        'codex:qa': 'qa-session-ui',
        'codex:fixer': 'fix-session-ui',
        'codex:archiver': 'archive-session-ui',
      },
      workflow_config: {
        stages: {
          planning: { tool: 'codex' },
          execution: { tool: 'codex' },
          review_1: { tool: 'codex' },
          qa_1: { tool: 'codex' },
          fix_1: { tool: 'codex' },
          archive: { tool: 'codex' },
        },
      },
      paths: {},
    }, null, 2)}\n`,
    'utf8',
  );
}

test('workflow status tree lets users inspect former DAG child sessions and artifacts', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await writeWorkflowDagUiFixture();
  await openFixtureProject(page, { reset: false });
  await page.reload({ waitUntil: 'networkidle' });

  const workflowCard = page.getByRole('button', { name: new RegExp(CHANGE_NAME) }).first();
  await expect(workflowCard).toBeVisible();

  const workflowDetailResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response.url().includes('/api/projects/')
    && response.url().includes(`/workflows/${RUN_ID}`)
  ));
  await workflowCard.click();
  await workflowDetailResponse;

  const workflowDetailUrl = page.url();
  const tree = page.getByTestId('workflow-status-tree');
  await expect(tree).toBeVisible();
  await expect(page.getByText('DAG 审查')).toHaveCount(0);
  await expect(page.getByTestId('workflow-dag-view')).toHaveCount(0);
  await expect(page.getByTestId('workflow-review-panel')).toHaveCount(0);

  await page.getByTestId('workflow-status-tree-row-execution').getByRole('button', { name: '执行阶段' }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${RUN_ID}/sessions/`));

  await page.goto(workflowDetailUrl, { waitUntil: 'networkidle' });
  await page.getByTestId('workflow-status-tree-row-review_1').getByRole('button', { name: 'review-1.json' }).click();
  await expect(page.getByRole('heading', { name: 'review-1.json' })).toBeVisible();

  const resultDir = path.join(process.cwd(), 'test-results', 'workflow-dag-review');
  await fs.mkdir(resultDir, { recursive: true });
  await page.screenshot({ path: path.join(resultDir, 'dag-detail.png'), fullPage: true });
  await fs.writeFile(
    path.join(resultDir, 'console-errors.json'),
    `${JSON.stringify(consoleErrors, null, 2)}\n`,
    'utf8',
  );

  expect(consoleErrors).toEqual([]);
});
