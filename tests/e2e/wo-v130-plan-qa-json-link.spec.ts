// @ts-nocheck -- Acceptance fixture state is dynamic and finalized during execution.
/**
 * PURPOSE: Exercise the oz flow v1.3.0 workflow detail path in a real browser so
 * the plan/acceptance merge and iterative QA JSON artifacts stay user-visible
 * across refreshes, repeated opens, and missing-artifact failure states.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  authHeaders,
  authenticatePage,
  getFixtureProject,
  openFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';
import { PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from './helpers/playwright-fixture.ts';
import { resolveFlowRunStatePath } from '../../backend/domains/workflows/flow-runtime-paths.ts';

const RUN_ID = 'run-fixture';
const CHANGE_NAME = '69-适配oz flow计划验收合并阶段并开放QA-JSON链接';
const TEST_RESULTS_DIR = 'tests/test-results';

/**
 * Build the oz flow v1.3.0 stage configuration expected by sealed runs.
 */
function workflowConfig() {
  const high = { tool: 'codex', reasoning: 'high', fast: false };
  return {
    max_review_iterations: 2,
    stages: {
      planning: { tool: 'codex', reasoning: 'xhigh', fast: true },
      execution: { tool: 'codex', reasoning: 'low', fast: false },
      review_1: high,
      qa_1: high,
      fix_1: { tool: 'codex', reasoning: 'low', fast: false },
      review_2: high,
      qa_2: high,
      fix_2: { tool: 'codex', reasoning: 'low', fast: false },
      archive: { tool: 'codex', reasoning: 'low', fast: false },
    },
  };
}

/**
 * Return the durable run directory for the shared fixture workflow.
 */
function getRunRoot() {
  const statePath = resolveFlowRunStatePath(PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0], RUN_ID);
  return path.dirname(statePath);
}

/**
 * Write one artifact inside the real oz flow run directory.
 */
function writeRunFile(fileName, content) {
  const runRoot = getRunRoot();
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, fileName), content, 'utf8');
}

/**
 * Persist a oz flow v1.3.0 state with optional latest QA JSON presence.
 */
function writeV130WorkflowFixture({ includeLatestQa = true } = {}) {
  const statePath = resolveFlowRunStatePath(PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0], RUN_ID);
  const runRoot = path.dirname(statePath);
  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(runRoot, { recursive: true });

  writeRunFile('review-1.json', JSON.stringify({ decision: 'needs_fix', findings: [{ title: 'runtime issue' }] }, null, 2));
  writeRunFile('qa-1.json', JSON.stringify({ decision: 'needs_fix', summary: 'runtime issue' }, null, 2));
  writeRunFile('fix-1-summary.md', '# Fix\n\nRuntime issue repaired.\n');
  writeRunFile('review-2.json', JSON.stringify({ decision: 'clean', findings: [] }, null, 2));
  if (includeLatestQa) {
    writeRunFile('qa-2.json', JSON.stringify({
      decision: 'clean',
      summary: 'QA covered acceptance contract and runtime evidence.',
      acceptance_matrix: [{ id: 'e2e-wo-v130-qa-json-refresh-repeat-failure', result: 'passed' }],
    }, null, 2));
  }

  fs.writeFileSync(statePath, `${JSON.stringify({
    run_id: RUN_ID,
    change_name: CHANGE_NAME,
    sealed: true,
    status: 'running',
    stage: 'qa_2',
    stages: {
      execution: 'completed',
      review_1: 'completed',
      qa_1: 'completed',
      fix_1: 'completed',
      review_2: 'completed',
      qa_2: 'running',
      archive: 'pending',
    },
    sessions: {
      'codex:planner': 'fixture-project-session',
      'codex:executor': 'fixture-project-execution-session',
      'codex:reviewer': 'reviewer-session-v130',
      'codex:qa': 'qa-session-v130',
      'codex:fixer': 'fixer-session-v130',
    },
    workflow_config: workflowConfig(),
    paths: includeLatestQa ? {} : {
      qa_2: path.join(runRoot, 'qa-2.json'),
    },
  }, null, 2)}\n`, 'utf8');
}

/**
 * Capture browser console, request, and API failure state for assertions.
 */
function installBrowserAudit(page) {
  const audit = { consoleErrors: [], requestFailures: [], apiFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') {
      audit.consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    // ERR_ABORTED is normal browser behavior during page reload / navigation
    const errorText = request.failure()?.errorText || '';
    if (errorText.includes('ERR_ABORTED')) {
      return;
    }
    audit.requestFailures.push(`${request.method()} ${request.url()} ${errorText}`);
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      audit.apiFailures.push(`${response.status()} ${response.url()}`);
    }
  });
  return audit;
}

/**
 * Open the v1.3.0 workflow detail page from the project overview.
 */
async function openV130WorkflowDetail(page) {
  const workflowDetailResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response.url().includes('/api/projects/')
    && /\/workflows\/[^/?]+(?:\?|$)/.test(response.url())
  ));
  await page.getByTestId('project-overview-workflows').getByRole('button', { name: /适配oz flow计划验收合并阶段/ }).first().click();
  const response = await workflowDetailResponse;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
}

test.describe('oz flow v1.3.0 plan/acceptance merged QA JSON user path', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
    await openFixtureProject(page);
  });

  test('QA JSON link survives refresh and repeated opens without an acceptance row', async ({ page }) => {
    const audit = installBrowserAudit(page);
    writeV130WorkflowFixture({ includeLatestQa: true });
    await page.reload({ waitUntil: 'networkidle' });
    await openV130WorkflowDetail(page);

    await expect(page.getByTestId('workflow-status-tree-row-acceptance')).toHaveCount(0);
    await expect(page.getByTestId('workflow-status-tree-row-qa_1')).toContainText('qa-1.json');
    const qaRow = page.getByTestId('workflow-status-tree-row-qa_2');
    await expect(qaRow).toContainText('QA 阶段');
    const qaStageButton = qaRow.getByRole('button', { name: 'QA 阶段' });
    const qaArtifactButton = qaRow.getByRole('button', { name: 'qa-2.json' });
    await expect(qaStageButton).toBeVisible();
    await expect(qaArtifactButton).toBeVisible();
    const [qaStageBox, qaArtifactBox] = await Promise.all([
      qaStageButton.boundingBox(),
      qaArtifactButton.boundingBox(),
    ]);
    expect(qaStageBox).not.toBeNull();
    expect(qaArtifactBox).not.toBeNull();
    expect(Math.abs((qaStageBox?.y || 0) - (qaArtifactBox?.y || 0))).toBeLessThan(8);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('workflow-status-tree')).toBeVisible();
    await expect(page.getByTestId('workflow-status-tree-row-acceptance')).toHaveCount(0);
    await expect(page.getByTestId('workflow-status-tree-row-qa_2').getByRole('button', { name: 'qa-2.json' })).toBeVisible();

    await page.getByTestId('workflow-status-tree-row-qa_2').getByRole('button', { name: 'qa-2.json' }).click();
    await expect(page.getByRole('heading', { name: 'qa-2.json' })).toBeVisible();
    await page.getByTestId('workflow-status-tree-row-qa_2').getByRole('button', { name: 'qa-2.json' }).click();
    await expect(page.getByRole('heading', { name: 'qa-2.json' })).toBeVisible();

    expect(audit.consoleErrors).toEqual([]);
    expect(audit.requestFailures).toEqual([]);
    expect(audit.apiFailures).toEqual([]);
  });

  test('missing latest QA JSON has diagnostics and no broken artifact link', async ({ page }) => {
    const audit = installBrowserAudit(page);
    writeV130WorkflowFixture({ includeLatestQa: false });
    await page.reload({ waitUntil: 'networkidle' });
    await openV130WorkflowDetail(page);

    await expect(page.getByTestId('workflow-status-tree-row-acceptance')).toHaveCount(0);
    await expect(page.getByTestId('workflow-status-tree-row-qa_2').getByRole('button', { name: 'qa-2.json' })).toHaveCount(0);
    await expect(page.getByText(/Expected qa-N artifact not found/)).toHaveCount(0);

    const project = await getFixtureProject(page.request);
    const detailResponse = await page.request.get(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/${RUN_ID}`,
      { headers: authHeaders() },
    );
    expect(detailResponse.ok()).toBeTruthy();
    const workflow = await detailResponse.json();
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(TEST_RESULTS_DIR, '69-wo-v130-missing-qa-json-workflow.json'),
      `${JSON.stringify(workflow, null, 2)}\n`,
      'utf8',
    );
    const warnings = workflow?.diagnostics?.warnings || workflow?.runnerDiagnostics?.warnings || [];
    expect(warnings.some((warning) => String(warning).includes('qa-2.json'))).toBeTruthy();

    expect(audit.consoleErrors).toEqual([]);
    expect(audit.requestFailures).toEqual([]);
    expect(audit.apiFailures).toEqual([]);
  });
});
