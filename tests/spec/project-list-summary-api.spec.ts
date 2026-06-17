// Sources: 101-首页项目清单轻量化
// @ts-nocheck -- 浏览器/API 规格测试覆盖真实 HTTP 合同，类型边界由运行时断言保护。
/**
 * PURPOSE: Verify the first-paint project API returns only lightweight project
 * summaries, while one selected project can load sessions/workflows on demand.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveFlowRunStatePath } from '../../backend/domains/workflows/flow-runtime-paths.ts';
import {
  authHeaders,
  authenticatePage,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import { ensurePlaywrightFixture } from '../e2e/helpers/playwright-fixture.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results', 'project-list-summary-api');
const FIXTURE_SESSION_ID = 'fixture-project-manual-session';
const FIXTURE_WORKFLOW_RUN_ID = 'run-fixture';
const FIXTURE_WORKFLOW_TITLE = '登录升级';

/**
 * Persist the workflow runner state used by overview and live refresh tests.
 */
async function writeWorkflowState(runId: string, changeName: string, status: string, stage: string, updatedAt: string) {
  /**
   * PURPOSE: Update the same real oz flow state file a Go runner watcher reads
   * so browser tests exercise the production refresh contract.
   */
  const statePath = resolveFlowRunStatePath(PRIMARY_FIXTURE_PROJECT_PATH, runId);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify({
    run_id: runId,
    change_name: changeName,
    status,
    stage,
    updated_at: updatedAt,
    stages: stage === 'done'
      ? { execution: 'completed', review_1: 'completed', qa_1: 'completed', archive: 'completed' }
      : { execution: 'running' },
    sessions: {},
    paths: {},
    error: '',
  }, null, 2)}\n`, 'utf8');
}

/**
 * Prepare realistic provider and workflow history for the API contract.
 */
async function prepareProjectSummaryFixture() {
  /**
   * PURPOSE: Keep the fixture business-shaped: one project with real provider
   * transcript history and one real workflow run on disk.
   */
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
}

/**
 * Return a human-sized snapshot of the response for QA evidence.
 */
function summarizeProject(project) {
  /**
   * PURPOSE: Persist only the fields needed to audit API boundaries without
   * copying full transcripts into test-results.
   */
  const json = JSON.stringify(project || {});
  return {
    keys: Object.keys(project || {}).sort(),
    byteLength: Buffer.byteLength(json, 'utf8'),
    hasSessions: Array.isArray(project?.sessions),
    hasCodexSessions: Array.isArray(project?.codexSessions),
    hasPiSessions: Array.isArray(project?.piSessions),
    hasWorkflows: Array.isArray(project?.workflows),
    hasBatches: Array.isArray(project?.batches),
    sample: project,
  };
}

/**
 * Fetch JSON with the local authenticated request context.
 */
async function fetchJson(request, url) {
  /**
   * PURPOSE: Use the real HTTP API and auth middleware so the contract covers
   * the same route a browser refresh uses.
   */
  const response = await request.get(url, { headers: authHeaders() });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { parseError: text.slice(0, 500) };
  }
  return { response, json, text };
}

test.beforeEach(async ({ page }) => {
  await prepareProjectSummaryFixture();
  await authenticatePage(page);
});

test('默认项目清单只返回轻量项目摘要', async ({ page }) => {
  const network = [];
  const { response, json, text } = await fetchJson(page.request, '/api/projects');
  network.push({ url: '/api/projects', status: response.status(), bytes: Buffer.byteLength(text, 'utf8') });

  expect(response.ok(), `项目清单请求失败: ${response.status()} ${text.slice(0, 300)}`).toBe(true);
  expect(Array.isArray(json)).toBe(true);

  const project = json.find((entry) => entry.fullPath === PRIMARY_FIXTURE_PROJECT_PATH || entry.path === PRIMARY_FIXTURE_PROJECT_PATH);
  const summary = summarizeProject(project);
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'project-summary-response.json'),
    `${JSON.stringify({ network, summary }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'network-summary.json'),
    `${JSON.stringify(network, null, 2)}\n`,
    'utf8',
  );

  expect(project, 'fixture 项目必须出现在默认项目清单中').toBeTruthy();
  expect(project.name, '摘要必须保留项目路由名').toBeTruthy();
  expect(project.displayName, '摘要必须保留项目展示名').toBeTruthy();
  expect(project.fullPath || project.path, '摘要必须保留项目路径').toBe(PRIMARY_FIXTURE_PROJECT_PATH);
  expect(project.routePath, '摘要必须保留项目 routePath').toBeTruthy();

  expect(summary.hasSessions, '默认项目清单不得返回 legacy sessions 数组').toBe(false);
  expect(summary.hasCodexSessions, '默认项目清单不得返回 Codex 会话数组').toBe(false);
  expect(summary.hasPiSessions, '默认项目清单不得返回 Pi 会话数组').toBe(false);
  expect(summary.hasWorkflows, '默认项目清单不得返回 workflow 数组').toBe(false);
  expect(summary.hasBatches, '默认项目清单不得返回 batch 数组').toBe(false);
  expect(summary.byteLength, '单个项目摘要必须保持有界，防止重集合回流').toBeLessThan(2200);
});

test('单项目 overview 按需返回最近会话和 workflow 概览', async ({ page }) => {
  const network = [];
  const projectList = await fetchJson(page.request, '/api/projects');
  network.push({ url: '/api/projects', status: projectList.response.status(), bytes: Buffer.byteLength(projectList.text, 'utf8') });
  expect(projectList.response.ok()).toBe(true);
  const project = projectList.json.find((entry) => entry.fullPath === PRIMARY_FIXTURE_PROJECT_PATH || entry.path === PRIMARY_FIXTURE_PROJECT_PATH);
  expect(project, '需要先从轻量项目清单中获得项目名').toBeTruthy();

  const overviewUrl = `/api/projects/${encodeURIComponent(project.name)}/overview?projectPath=${encodeURIComponent(PRIMARY_FIXTURE_PROJECT_PATH)}`;
  const overview = await fetchJson(page.request, overviewUrl);
  network.push({ url: overviewUrl, status: overview.response.status(), bytes: Buffer.byteLength(overview.text, 'utf8') });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'network-summary.json'),
    `${JSON.stringify(network, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'project-overview-response.json'),
    `${JSON.stringify({
      status: overview.response.status(),
      keys: Object.keys(overview.json || {}).sort(),
      codexTitles: (overview.json?.codexSessions || []).map((session) => session.summary || session.title || session.id),
      workflowTitles: (overview.json?.workflows || []).map((workflow) => workflow.title || workflow.objective || workflow.id),
      sample: overview.json,
    }, null, 2)}\n`,
    'utf8',
  );

  expect(overview.response.ok(), `overview 请求必须成功: ${overview.response.status()} ${overview.text.slice(0, 300)}`).toBe(true);
  expect(Array.isArray(overview.json?.codexSessions), 'overview 必须按需返回 Codex 最近会话').toBe(true);
  expect(Array.isArray(overview.json?.workflows), 'overview 必须按需返回 workflow 概览').toBe(true);
  expect(
    overview.json.codexSessions.some((session) => session.id === FIXTURE_SESSION_ID),
    'overview 必须包含启动 backfill 写入 DB 的真实 Codex fixture 会话',
  ).toBe(true);
  expect(
    overview.json.workflows.some((workflow) => String(workflow.title || workflow.objective || '').includes(FIXTURE_WORKFLOW_TITLE)),
    'overview 必须包含启动 workflow 索引写入 DB 的真实 wo fixture 工作流',
  ).toBe(true);
});

test('workflow 详情停留时响应 runner state 文件变化', async ({ page }) => {
  const projectList = await fetchJson(page.request, '/api/projects');
  expect(projectList.response.ok()).toBe(true);
  const project = projectList.json.find((entry) => entry.fullPath === PRIMARY_FIXTURE_PROJECT_PATH || entry.path === PRIMARY_FIXTURE_PROJECT_PATH);
  expect(project, '需要先从轻量项目清单中获得项目路由').toBeTruthy();

  const routePrefix = project.routePath || project.fullPath || project.path;
  await page.goto(`${routePrefix}/runs/${FIXTURE_WORKFLOW_RUN_ID}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: FIXTURE_WORKFLOW_TITLE })).toBeVisible();

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'workflow-detail-before-refresh.png'),
    fullPage: true,
  });

  await page.waitForTimeout(1200);
  await writeWorkflowState(
    FIXTURE_WORKFLOW_RUN_ID,
    FIXTURE_WORKFLOW_TITLE,
    'done',
    'done',
    '2026-06-11T08:06:00.000Z',
  );

  await expect(page.getByRole('heading', { name: FIXTURE_WORKFLOW_TITLE })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'workflow-detail-after-refresh.png'),
    fullPage: true,
  });
});
