// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: 验收测试：规划阶段展示真实 oz change 顶层产物并可点击打开。
 * 覆盖 active change、无规划会话、归档后刷新场景，验证文档内容和路径正确性。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';
import { PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from '../e2e/helpers/playwright-fixture.ts';
import { resolveFlowRunStatePath } from '../../backend/domains/workflows/flow-runtime-paths.ts';

const OZ_CHANGE_NAME = '2026-05-14-test-planning-docs';

const ACTIVE_PROPOSAL = '# 提案\n\nACTIVE 测试提案内容。\n';
const ACTIVE_DESIGN = '# 设计\n\nACTIVE 测试设计内容。\n';
const ACTIVE_SPEC = '# 规格\n\nACTIVE 测试规格内容。\n';
const ACTIVE_TASK = '# 任务\n\nACTIVE 测试任务内容。\n';
const ACTIVE_BRIEF = '# 简报\n\nACTIVE 测试简报内容。\n';
const ACTIVE_ACCEPTANCE = '{ "summary": "ACTIVE 测试验收合同" }\n';
const ACTIVE_EXTRA = '# 额外产物\n\nACTIVE 额外顶层产物。\n';
const ARCHIVE_PROPOSAL = '# 提案\n\nARCHIVE 测试提案内容。\n';

/**
 * Create active oz change top-level artifacts in the fixture project.
 */
function writeActiveOzChangeDocs() {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const changeDir = path.join(projectPath, 'docs', 'changes', OZ_CHANGE_NAME);
  fs.mkdirSync(path.join(changeDir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(changeDir, 'notes'), { recursive: true });

  fs.writeFileSync(path.join(changeDir, 'brief.md'), ACTIVE_BRIEF, 'utf8');
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), ACTIVE_PROPOSAL, 'utf8');
  fs.writeFileSync(path.join(changeDir, 'design.md'), ACTIVE_DESIGN, 'utf8');
  fs.writeFileSync(path.join(changeDir, 'spec.md'), ACTIVE_SPEC, 'utf8');
  fs.writeFileSync(path.join(changeDir, 'task.md'), ACTIVE_TASK, 'utf8');
  fs.writeFileSync(path.join(changeDir, 'acceptance.json'), ACTIVE_ACCEPTANCE, 'utf8');
  fs.writeFileSync(path.join(changeDir, 'tests', 'planning-docs.spec.ts'), 'export {};\n', 'utf8');
  fs.writeFileSync(path.join(changeDir, 'notes', 'qa-note.md'), '# QA Note\n', 'utf8');
  fs.writeFileSync(path.join(changeDir, 'z-extra.md'), ACTIVE_EXTRA, 'utf8');
}

/**
 * Write a wo state fixture with change_name and a planning session.
 */
function writeActivePlanningWorkflowFixture() {
  writeWorkflowFixture({ withSession: true });
}

/**
 * Write a wo state fixture with change_name but NO planning session.
 */
function writeActivePlanningWorkflowFixtureNoSession() {
  writeWorkflowFixture({ withSession: false });
}

function writeWorkflowFixture({ withSession }) {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const statePath = resolveFlowRunStatePath(projectPath, 'run-fixture');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const baseState = {
    ...state,
    change_name: OZ_CHANGE_NAME,
    status: 'running',
    stage: 'planning',
    stages: { planning: 'active', execution: 'pending' },
  };
  if (withSession) {
    baseState.sessions = { ...baseState.sessions, 'codex:planner': 'planning-session-id' };
  } else {
    // Remove planning session key explicitly so there is no jump-able session link
    if (baseState.sessions) {
      delete baseState.sessions['codex:planner'];
    }
  }
  fs.writeFileSync(statePath, `${JSON.stringify(baseState, null, 2)}\n`, 'utf8');
}

/**
 * Move active oz change to archive, overwrite proposal.md with archive content,
 * and update the wo state.
 */
function archiveOzChangeAndRefreshWorkflow() {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const activeDir = path.join(projectPath, 'docs', 'changes', OZ_CHANGE_NAME);
  const archiveDir = path.join(projectPath, 'docs', 'changes', 'archive', OZ_CHANGE_NAME);
  fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
  fs.renameSync(activeDir, archiveDir);

  // Overwrite proposal.md with archive-specific content so tests can verify
  // the archived file is opened, not a stale active-path reference.
  fs.writeFileSync(path.join(archiveDir, 'proposal.md'), ARCHIVE_PROPOSAL, 'utf8');

  // Update the wo state so the backend re-reads after refresh
  const statePath = resolveFlowRunStatePath(projectPath, 'run-fixture');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Navigate from the project overview into the workflow detail page.
 * After setting change_name, the workflow card title becomes OZ_CHANGE_NAME.
 */
async function navigateToWorkflowDetail(page) {
  const workflowsPanel = page.getByTestId('project-overview-workflows');
  const workflowCard = workflowsPanel.getByRole('button', { name: OZ_CHANGE_NAME }).first();
  if (await workflowCard.count() === 0) {
    await workflowsPanel.getByRole('button', { name: /自动工作流/ }).click();
  }
  await workflowCard.click();
}

/**
 * Open the workflow detail page for the fixture run (active change, with session).
 */
async function openWorkflowDetailPage(page) {
  await authenticatePage(page);
  await openFixtureProject(page);

  writeActiveOzChangeDocs();
  writeActivePlanningWorkflowFixture();
  await page.reload({ waitUntil: 'networkidle' });

  await navigateToWorkflowDetail(page);
}

/**
 * Open the workflow detail page for the fixture run (active change, NO session).
 */
async function openWorkflowDetailPageNoSession(page) {
  await authenticatePage(page);
  await openFixtureProject(page);

  writeActiveOzChangeDocs();
  writeActivePlanningWorkflowFixtureNoSession();
  await page.reload({ waitUntil: 'networkidle' });

  await navigateToWorkflowDetail(page);
}

test.describe('规划阶段 oz 顶层产物链接', () => {
  test('active change 下规划行展示真实顶层产物并可点击打开 proposal.md', async ({ page }) => {
    test.setTimeout(60000);
    await openWorkflowDetailPage(page);

    const planningRow = page.getByTestId('workflow-status-tree-row-planning');
    await expect(planningRow).toBeVisible();
    await expect(planningRow).toContainText('规划阶段');

    await expect(planningRow.getByRole('button', { name: 'brief.md' })).toBeVisible();
    const proposalBtn = planningRow.getByRole('button', { name: 'proposal.md' });
    await expect(proposalBtn).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'design.md' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'spec.md' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'task.md' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'acceptance.json' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'tests/planning-docs.spec.ts', exact: true })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'tests/', exact: true })).toHaveCount(0);
    await expect(planningRow.getByRole('button', { name: 'notes/' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'z-extra.md' })).toBeVisible();

    // Click proposal.md and verify editor opens with correct active content
    await proposalBtn.click();
    await expect(page.getByRole('heading', { name: 'proposal.md' })).toBeVisible();
    await expect(page.getByText('ACTIVE 测试提案内容')).toBeVisible();
  });

  test('规划会话缺失时仍展示文档链接并可打开文档', async ({ page }) => {
    test.setTimeout(60000);
    await openWorkflowDetailPageNoSession(page);

    const planningRow = page.getByTestId('workflow-status-tree-row-planning');
    await expect(planningRow).toBeVisible();

    // Artifact links must still be present and clickable
    const proposalBtn = planningRow.getByRole('button', { name: 'proposal.md' });
    await expect(proposalBtn).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'brief.md' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'design.md' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'spec.md' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'task.md' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'acceptance.json' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'tests/planning-docs.spec.ts', exact: true })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'tests/', exact: true })).toHaveCount(0);

    // Clicking a doc without a planning session must still open the editor
    await proposalBtn.click();
    await expect(page.getByRole('heading', { name: 'proposal.md' })).toBeVisible();
  });

  test('change 归档后刷新详情页四个链接仍指向归档文档', async ({ page }) => {
    test.setTimeout(60000);
    await openWorkflowDetailPage(page);

    // Verify active docs are visible and openable with active content
    const planningRow = page.getByTestId('workflow-status-tree-row-planning');
    await expect(planningRow.getByRole('button', { name: 'proposal.md' })).toBeVisible();

    await planningRow.getByRole('button', { name: 'proposal.md' }).click();
    await expect(page.getByText('ACTIVE 测试提案内容')).toBeVisible();

    // Archive the change (renames dir to archive + overwrites proposal.md with archive content)
    archiveOzChangeAndRefreshWorkflow();
    // Reload stays on the detail page — docs are already visible there after refresh
    await page.reload({ waitUntil: 'networkidle' });

    // After archive + reload, planning artifacts must still be visible on the current detail page
    const archivedPlanningRow = page.getByTestId('workflow-status-tree-row-planning');
    await expect(archivedPlanningRow.getByRole('button', { name: 'brief.md' })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'proposal.md' })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'design.md' })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'spec.md' })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'task.md' })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'acceptance.json' })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'tests/planning-docs.spec.ts', exact: true })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'tests/', exact: true })).toHaveCount(0);

    // Click proposal.md - must open the archived file with archive-specific content
    await archivedPlanningRow.getByRole('button', { name: 'proposal.md' }).click();
    await expect(page.getByRole('heading', { name: 'proposal.md' })).toBeVisible();
    await expect(page.getByText('ARCHIVE 测试提案内容')).toBeVisible();
    // Active content must NOT be shown (proves we are reading from archive, not stale active path)
    await expect(page.getByText('ACTIVE 测试提案内容')).toHaveCount(0);
  });
});
