// @ts-nocheck -- 执行阶段浏览器回归：验证 oz flow status/watch 风格阶段树。
/**
 * PURPOSE: Verify the ozw workflow detail page renders the oz flow status-style
 * workflow tree and no longer exposes the old DAG review surface.
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

const CHANGE_NAME = '93-状态栏新格式浏览器fixture';
const RUN_ID = 'run-status-watch-dag-ui';

/**
 * Write a real wo state fixture and artifacts into the Playwright workspace.
 */
async function writeWorkflowStatusWatchDagFixture() {
  const statePath = resolveFlowRunStatePath(PRIMARY_FIXTURE_PROJECT_PATH, RUN_ID);
  const runRoot = path.dirname(statePath);
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  await fs.rm(path.join(PRIMARY_FIXTURE_PROJECT_PATH, 'docs', 'changes', CHANGE_NAME), {
    recursive: true,
    force: true,
  });

  await writeWorkspaceTextFile(`docs/changes/${CHANGE_NAME}/proposal.md`, '# 状态栏新格式浏览器 fixture\n');
  await writeWorkspaceTextFile(`docs/changes/${CHANGE_NAME}/design.md`, '# Design\n');
  await writeWorkspaceTextFile(`docs/changes/${CHANGE_NAME}/spec.md`, '# Spec\n');
  await writeWorkspaceTextFile(`docs/changes/${CHANGE_NAME}/task.md`, '# Task\n');

  await fs.writeFile(path.join(runRoot, 'review-1.json'), '{"decision":"needs_fix"}\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'review-1.md'), '# Review 1\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'fix-1-summary.md'), '# Fix 1\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'delivery-summary.md'), '# Delivery\n\nArchive package.\n', 'utf8');

  await fs.writeFile(
    statePath,
    `${JSON.stringify({
      run_id: RUN_ID,
      change_name: CHANGE_NAME,
      sealed: true,
      engine: 'go-dag',
      status: 'running',
      stage: 'archive',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        fix_1: 'completed',
        archive: 'running',
      },
      sessions: {
        'codex:reviewer': 'shared-provider-session-ui',
        'pi:executor': 'shared-provider-session-ui',
        'pi:fixer': 'fixer-session-ui',
        'pi:archiver': 'archiver-session-ui',
      },
      workflow_config: {
        engine: 'go-dag',
        max_review_iterations: 30,
      },
      paths: {},
    }, null, 2)}\n`,
    'utf8',
  );
}

test('workflow detail renders oz flow status/watch tree without DAG review surface', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await writeWorkflowStatusWatchDagFixture();
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

  const executorRow = page.getByTestId('workflow-status-tree-row-execution');
  await expect(executorRow).toContainText('执行阶段');
  const reviewerRow = page.getByTestId('workflow-status-tree-row-review_1');
  await expect(reviewerRow).toContainText('审核阶段');
  const reviewStageButton = reviewerRow.getByRole('button', { name: '审核阶段' });
  const reviewJsonButton = reviewerRow.getByRole('button', { name: 'review-1.json' });
  const reviewMarkdownButton = reviewerRow.getByRole('button', { name: 'review-1.md' });
  await expect(reviewStageButton).toBeVisible();
  await expect(reviewJsonButton).toBeVisible();
  await expect(reviewMarkdownButton).toBeVisible();
  const [reviewStageBox, reviewJsonBox, reviewMarkdownBox] = await Promise.all([
    reviewStageButton.boundingBox(),
    reviewJsonButton.boundingBox(),
    reviewMarkdownButton.boundingBox(),
  ]);
  expect(reviewStageBox).not.toBeNull();
  expect(reviewJsonBox).not.toBeNull();
  expect(reviewMarkdownBox).not.toBeNull();
  expect(Math.abs((reviewStageBox?.y || 0) - (reviewJsonBox?.y || 0))).toBeLessThan(8);
  expect(Math.abs((reviewStageBox?.y || 0) - (reviewMarkdownBox?.y || 0))).toBeLessThan(8);
  const fixerRow = page.getByTestId('workflow-status-tree-row-fix_1');
  await expect(fixerRow).toContainText('修复阶段');
  await expect(page.getByTestId('workflow-round-1')).toHaveCount(0);
  await expect(page.getByTestId('workflow-stage-provider-badge')).toHaveCount(0);
  const fixStageButton = fixerRow.getByRole('button', { name: '修复阶段' });
  const fixArtifactButton = fixerRow.getByRole('button', { name: 'fix-1-summary.md' });
  await expect(fixStageButton).toBeVisible();
  await expect(fixArtifactButton).toBeVisible();
  const [fixStageBox, fixArtifactBox] = await Promise.all([
    fixStageButton.boundingBox(),
    fixArtifactButton.boundingBox(),
  ]);
  expect(fixStageBox).not.toBeNull();
  expect(fixArtifactBox).not.toBeNull();
  expect(Math.abs((fixStageBox?.y || 0) - (fixArtifactBox?.y || 0))).toBeLessThan(8);
  const archiverRow = page.getByTestId('workflow-status-tree-row-archive');
  await expect(archiverRow).toContainText('归档阶段');
  const archiveStageButton = archiverRow.getByRole('button', { name: '归档阶段' });
  const archiveArtifactButton = archiverRow.getByRole('button', { name: 'delivery-summary.md' });
  await expect(archiveStageButton).toBeVisible();
  await expect(archiveArtifactButton).toBeVisible();
  const [archiveStageBox, archiveArtifactBox] = await Promise.all([
    archiveStageButton.boundingBox(),
    archiveArtifactButton.boundingBox(),
  ]);
  expect(archiveStageBox).not.toBeNull();
  expect(archiveArtifactBox).not.toBeNull();
  expect(Math.abs((archiveStageBox?.y || 0) - (archiveArtifactBox?.y || 0))).toBeLessThan(8);

  // Provider-aware navigation: the pi executor shares an id with the codex reviewer.
  // Clicking each row must route to the matching provider/stage child session.
  await executorRow.getByRole('button', { name: '执行阶段' }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${RUN_ID}/sessions/execution`));

  await page.goto(workflowDetailUrl);
  await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
  await page.getByTestId('workflow-status-tree-row-review_1').getByRole('button', { name: '审核阶段' }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${RUN_ID}/sessions/review_1`));

  await page.goto(workflowDetailUrl);
  await expect(page.getByTestId('workflow-status-tree-row-review_1').getByRole('button', { name: 'review-1.json' })).toBeVisible();
  await page.getByTestId('workflow-status-tree-row-review_1').getByRole('button', { name: 'review-1.json' }).click();
  await expect(page.getByRole('heading', { name: 'review-1.json' })).toBeVisible();

  const resultDir = path.join(process.cwd(), 'test-results', 'wo-status-watch-dag');
  await fs.mkdir(resultDir, { recursive: true });
  await page.screenshot({ path: path.join(resultDir, 'detail.png'), fullPage: true });
  await fs.writeFile(
    path.join(resultDir, 'console-errors.json'),
    `${JSON.stringify(consoleErrors, null, 2)}\n`,
    'utf8',
  );

  expect(consoleErrors).toEqual([]);
});
