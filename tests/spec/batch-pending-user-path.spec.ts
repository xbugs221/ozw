/**
 * PURPOSE: Exercise the real browser path for oz flow batch proposal visibility
 * after a user appends changes that have not started a run yet.
 */
import { expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listBatchReadModels } from '../../backend/domains/workflows/workflow-read-model.ts';
import { resolveFlowBatchesRoot, resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';
import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import { ensurePlaywrightFixture } from '../e2e/helpers/playwright-fixture.ts';

type BatchFixtureOptions = {
  batchId: string;
  changes: string[];
  runIds: Record<string, string>;
  currentIndex: number;
  status?: string;
  error?: string;
};

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/wo-batch-proposal-state');
const BATCH_ITEMS_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'batch-items.json');
const PENDING_AFTER_REFRESH_SCREENSHOT_PATH = path.join(EVIDENCE_DIR, 'pending-after-refresh.png');
const PENDING_NAVIGATION_TRACE_PATH = path.join(EVIDENCE_DIR, 'pending-user-path-trace.zip');
const FAILED_REPEAT_SCREENSHOT_PATH = path.join(EVIDENCE_DIR, 'failed-repeat-expand.png');

async function ensureEvidenceDir() {
  /**
   * PURPOSE: Keep the acceptance evidence paths stable so reviewers can
   * inspect the business state, screenshots, and navigation trace after tests.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
}

async function writeBatchFixture(options: BatchFixtureOptions) {
  /**
   * PURPOSE: Persist the same oz flow batch state shape that the sealed runtime
   * writes so the UI reads batch proposals through the production read model.
   */
  const batchDir = path.join(resolveFlowBatchesRoot(PRIMARY_FIXTURE_PROJECT_PATH), options.batchId);
  await fs.mkdir(batchDir, { recursive: true });
  await fs.writeFile(path.join(batchDir, 'state.json'), `${JSON.stringify({
    batch_id: options.batchId,
    status: options.status || 'running',
    current_index: options.currentIndex,
    changes: options.changes,
    run_ids: options.runIds,
    error: options.error || '',
    updated_at: '2029-06-02T10:00:00.000Z',
  }, null, 2)}\n`, 'utf8');
}

async function writeRunFixture(runId: string, changeName: string, status: 'done' | 'running') {
  /**
   * PURPOSE: Create real started oz flow run state for proposals that should remain
   * navigable while later appended proposals stay pending.
   */
  const runDir = path.join(resolveFlowRunsRoot(PRIMARY_FIXTURE_PROJECT_PATH), runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    run_id: runId,
    change_name: changeName,
    status,
    stage: status === 'done' ? 'archive' : 'execution',
    updated_at: status === 'done' ? '2029-06-02T09:00:00.000Z' : '2029-06-02T10:00:00.000Z',
    stages: status === 'done'
      ? { planning: 'completed', execution: 'completed', archive: 'completed' }
      : { planning: 'completed', execution: 'running', archive: 'pending' },
    sessions: {},
    paths: {},
    error: '',
  }, null, 2)}\n`, 'utf8');
}

async function writeBatchItemsEvidence(batchId: string) {
  /**
   * PURPOSE: Snapshot the production batch read model that backs the browser
   * list so acceptance can verify pending proposals without replaying the UI.
   */
  const batches = await listBatchReadModels(PRIMARY_FIXTURE_PROJECT_PATH);
  const batch = batches.find((item) => item.id === batchId);
  await ensureEvidenceDir();
  await fs.writeFile(BATCH_ITEMS_EVIDENCE_PATH, `${JSON.stringify({
    batchId,
    total: batch?.total,
    items: batch?.items || [],
  }, null, 2)}\n`, 'utf8');
}

async function findTraceZipFiles(dir: string): Promise<string[]> {
  /**
   * PURPOSE: Locate Playwright's real trace.zip artifacts after the runner has
   * written them so acceptance can keep a stable trace path.
   */
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return findTraceZipFiles(entryPath);
    }
    return entry.name === 'trace.zip' ? [entryPath] : [];
  }));
  return files.flat();
}

async function seedAppendedBatch(options: Pick<BatchFixtureOptions, 'batchId' | 'status' | 'error'> = {
  batchId: 'batch-appended-ui',
}) {
  /**
   * PURPOSE: Reset the isolated fixture and seed one batch where the third
   * proposal exists in changes but has no run id yet.
   */
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  await writeBatchFixture({
    batchId: options.batchId,
    status: options.status,
    error: options.error,
    currentIndex: 1,
    changes: ['change-a', 'change-b', 'change-c'],
    runIds: {
      'change-a': 'run-a',
      'change-b': 'run-b',
    },
  });
  await writeRunFixture('run-a', 'change-a', 'done');
  await writeRunFixture('run-b', 'change-b', 'running');
}

async function clickPendingEntryIfRenderedAsButton(page: Page, batchId: string) {
  /**
   * PURPOSE: Prove the pending proposal cannot be used as a fake workflow
   * detail route even if the implementation renders it with button semantics.
   */
  const pendingButton = page.getByTestId(`batch-group-${batchId}`).getByRole('button', { name: /change-c/ });
  if (await pendingButton.count() === 0) {
    return;
  }

  const beforeUrl = page.url();
  if (await pendingButton.first().isDisabled()) {
    await expect(pendingButton.first()).toBeDisabled();
    await expect(page).toHaveURL(beforeUrl);
    return;
  }

  await pendingButton.first().click();
  await expect(page).toHaveURL(beforeUrl);
}

test.describe('oz flow appended batch proposal browser contract', () => {
  test.afterAll(async () => {
    await ensureEvidenceDir();
    const traces = await findTraceZipFiles(path.resolve(process.cwd(), 'tests/test-results'));
    const pendingTrace = traces
      .filter((tracePath) => tracePath.includes('pending-appended-proposal'))
      .sort()
      .at(-1) || traces.sort().at(-1);
    if (pendingTrace) {
      await fs.copyFile(pendingTrace, PENDING_NAVIGATION_TRACE_PATH);
    }
  });

  test('pending appended proposal is visible, non-navigable, and survives refresh', async ({ page }) => {
    await seedAppendedBatch();
    await writeBatchItemsEvidence('batch-appended-ui');
    await openFixtureProject(page, { reset: false });

    const batchGroup = page.getByTestId('batch-group-batch-appended-ui');
    const batchHeader = page.getByTestId('batch-header-batch-appended-ui');
    await expect(batchHeader).toContainText('批量任务 b1');
    await expect(batchHeader).toContainText('2/3');
    await expect(batchGroup.getByRole('button', { name: /change-a/ })).toBeVisible();
    await expect(batchGroup.getByRole('button', { name: /change-b/ })).toBeVisible();
    await expect(batchGroup.getByText('change-c')).toBeVisible();
    await clickPendingEntryIfRenderedAsButton(page, 'batch-appended-ui');

    await batchGroup.getByRole('button', { name: /change-a/ }).click();
    await expect(page).toHaveURL(/\/runs\/run-a$/);
    await expect(page.getByTestId('workflow-role-summary')).toBeVisible();

    await openFixtureProject(page, { reset: false });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('batch-header-batch-appended-ui')).toContainText('2/3');
    await expect(page.getByTestId('batch-group-batch-appended-ui').getByText('change-c')).toBeVisible();
    await expect(page.getByTestId('project-overview-workflows')).not.toContainText('单次任务');
    await ensureEvidenceDir();
    await page.screenshot({ path: PENDING_AFTER_REFRESH_SCREENSHOT_PATH, fullPage: true });
  });

  test('failed batch keeps pending proposal state across repeated expand operations', async ({ page }) => {
    const longBatchError = [
      'fixture batch failed before starting change-c',
      'runner stderr: permission denied while creating workflow session under .wo/runs/batch-appended-failed-ui/sessions/change-c',
      'manual action: inspect the generated run directory and retry the remaining proposal after fixing filesystem permissions',
    ].join('\n');
    await seedAppendedBatch({
      batchId: 'batch-appended-failed-ui',
      status: 'failed',
      error: longBatchError,
    });
    await openFixtureProject(page, { reset: false });

    const batchGroup = page.getByTestId('batch-group-batch-appended-failed-ui');
    const batchHeader = page.getByTestId('batch-header-batch-appended-failed-ui');
    const batchError = page.getByTestId('batch-error-batch-appended-failed-ui');
    await expect(batchHeader).toContainText('2/3');
    await expect(batchError).toHaveText(longBatchError);
    await expect(batchError).not.toHaveClass(/truncate/);
    await expect(batchError).toHaveCSS('white-space', 'pre-wrap');
    await expect(batchGroup.getByRole('button', { name: /^change-c\b/ })).toBeVisible();

    await batchHeader.click();
    await batchHeader.click();
    await expect(batchHeader).toContainText('2/3');
    await expect(batchGroup.getByRole('button', { name: /^change-c\b/ })).toBeVisible();
    await clickPendingEntryIfRenderedAsButton(page, 'batch-appended-failed-ui');
    await ensureEvidenceDir();
    await page.screenshot({ path: FAILED_REPEAT_SCREENSHOT_PATH, fullPage: true });
  });
});
