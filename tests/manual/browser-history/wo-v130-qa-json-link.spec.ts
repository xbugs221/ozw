// @ts-nocheck -- Proposal contract test: Playwright fixture state is dynamic.
/**
 * PURPOSE: Verify the real workflow detail UI opens wo v1.3.0 QA JSON
 * artifacts from the QA role row just like review JSON artifacts.
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

const RUN_ID = 'run-fixture';
const CHANGE_NAME = '69-适配wo计划验收合并阶段并开放QA-JSON链接';
const TEST_RESULTS_DIR = 'tests/test-results';

/**
 * Build a v1.3.0 workflow snapshot with iterative QA stages.
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
 * Write one file in the durable wo run directory used by the fixture project.
 */
function writeRunFile(runRoot, fileName, content) {
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, fileName), content, 'utf8');
}

/**
 * Replace the shared fixture run with a wo v1.3.0 state and real QA JSON files.
 */
function writeV130WorkflowFixture() {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const statePath = resolveFlowRunStatePath(projectPath, RUN_ID);
  const runRoot = path.dirname(statePath);
  writeRunFile(runRoot, 'review-1.json', JSON.stringify({ decision: 'needs_fix', findings: [{ title: 'runtime issue' }] }, null, 2));
  writeRunFile(runRoot, 'qa-1.json', JSON.stringify({ decision: 'needs_fix', summary: 'runtime issue' }, null, 2));
  writeRunFile(runRoot, 'fix-1-summary.md', '# Fix\n\nRuntime issue repaired.\n');
  writeRunFile(runRoot, 'review-2.json', JSON.stringify({ decision: 'clean', findings: [] }, null, 2));
  writeRunFile(runRoot, 'qa-2.json', JSON.stringify({
    decision: 'clean',
    summary: 'QA covered acceptance contract and runtime evidence.',
    acceptance_matrix: [{ id: 'contract-wo-v130-qa-json-link', result: 'passed', evidence: ['screenshot-wo-v130-qa-json-open'] }],
  }, null, 2));

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
      'codex:executor': 'executor-session-v130',
      'codex:reviewer': 'reviewer-session-v130',
      'codex:qa': 'qa-session-v130',
      'codex:fixer': 'fixer-session-v130',
    },
    workflow_config: workflowConfig(),
    paths: {},
  }, null, 2)}\n`, 'utf8');
}

/**
 * Record browser-side runtime evidence for the proposal acceptance contract.
 */
function installBrowserAudit(page) {
  const audit = { consoleErrors: [], requestFailures: [], apiFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') {
      audit.consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
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

test.describe('wo v1.3.0 QA JSON workflow detail link', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
    await openFixtureProject(page);
    writeV130WorkflowFixture();
    await page.reload({ waitUntil: 'networkidle' });
  });

  test('QA row opens latest qa-N.json artifact without a standalone acceptance row', async ({ page }) => {
    const audit = installBrowserAudit(page);
    const workflowDetailResponse = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/api/projects/')
      && /\/workflows\/[^/?]+(?:\?|$)/.test(response.url())
    ));

    await page.getByTestId('project-overview-workflows').getByRole('button', { name: /适配wo计划验收合并阶段/ }).first().click();
    const response = await workflowDetailResponse;
    expect(response.ok()).toBeTruthy();

    await expect(page.getByTestId('workflow-role-row-acceptance')).toHaveCount(0);
    const qaRow = page.getByTestId('workflow-role-row-qa');
    await expect(qaRow).toContainText('x2');
    await expect(qaRow.getByRole('button', { name: 'qa-2.json' })).toBeVisible();
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(TEST_RESULTS_DIR, '69-wo-v130-detail.png'), fullPage: true });

    await qaRow.getByRole('button', { name: 'qa-2.json' }).click();
    await expect(page.getByRole('heading', { name: 'qa-2.json' })).toBeVisible();
    await page.screenshot({ path: path.join(TEST_RESULTS_DIR, '69-wo-v130-qa-json-open.png'), fullPage: true });

    fs.writeFileSync(
      path.join(TEST_RESULTS_DIR, '69-wo-v130-browser-audit.json'),
      `${JSON.stringify(audit, null, 2)}\n`,
      'utf8',
    );
    expect(audit.consoleErrors).toEqual([]);
    expect(audit.requestFailures).toEqual([]);
    expect(audit.apiFailures).toEqual([]);
  });
});
