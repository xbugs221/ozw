// Sources: 101-首页项目清单轻量化
// @ts-nocheck -- 浏览器/API 规格测试覆盖真实 HTTP 合同，类型边界由运行时断言保护。
/**
 * PURPOSE: Verify the first-paint project API returns only lightweight project
 * summaries, while one selected project can load sessions/workflows on demand.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveFlowRunStatePath, resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';
import {
  authHeaders,
  authenticatePage,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import { ensurePlaywrightFixture } from '../e2e/helpers/playwright-fixture.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results', 'project-list-summary-api');
const CONTRACT_SESSION_ID = 'spec-project-summary-codex-session';
const CONTRACT_SESSION_TITLE = '首页轻量化合同-Codex会话';
const CONTRACT_WORKFLOW_CHANGE = '首页轻量化合同工作流';
const LIVE_REFRESH_RUN_ID = 'run-project-summary-live-refresh';
const LIVE_REFRESH_WORKFLOW_CHANGE = '首页轻量化停留刷新工作流';

/**
 * Return the isolated Playwright HOME that owns provider JSONL history.
 */
function fixtureHomeDir() {
  /**
   * PURPOSE: Derive HOME from the fixture project path so the test uses the
   * same provider-history root as the local Playwright server.
   */
  return path.dirname(path.dirname(PRIMARY_FIXTURE_PROJECT_PATH));
}

/**
 * Write one real Codex JSONL transcript for the project overview contract.
 */
async function writeCodexSessionFixture() {
  /**
   * PURPOSE: Exercise the real Codex history discovery path instead of
   * injecting fake project JSON into the API response.
   */
  const sessionDir = path.join(fixtureHomeDir(), '.codex', 'sessions', '2026', '06', '11');
  const lines = [
    {
      type: 'session_meta',
      timestamp: '2026-06-11T08:00:00.000Z',
      payload: {
        id: CONTRACT_SESSION_ID,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        model: 'gpt-5-codex',
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-11T08:00:01.000Z',
      payload: {
        type: 'user_message',
        message: CONTRACT_SESSION_TITLE,
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-11T08:00:02.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '合同会话响应' }],
      },
    },
  ];

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, `${CONTRACT_SESSION_ID}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    'utf8',
  );
}

/**
 * Write one real wo state.json run for the overview workflow contract.
 */
async function writeWorkflowFixture() {
  /**
   * PURPOSE: Make the overview endpoint prove it still loads workflow data,
   * while the default project summary proves it no longer embeds that data.
   */
  await fs.rm(resolveFlowRunsRoot(PRIMARY_FIXTURE_PROJECT_PATH), { recursive: true, force: true });
  await writeWorkflowState('run-project-summary-api', CONTRACT_WORKFLOW_CHANGE, 'running', 'execution', '2026-06-11T08:05:00.000Z');
}

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
  await writeCodexSessionFixture();
  await writeWorkflowFixture();
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
    overview.json.codexSessions.some((session) => session.id === CONTRACT_SESSION_ID),
    'overview 必须包含写入的真实 Codex 合同会话记录',
  ).toBe(true);
  expect(
    overview.json.workflows.some((workflow) => String(workflow.title || workflow.objective || '').includes(CONTRACT_WORKFLOW_CHANGE)),
    'overview 必须包含写入的真实 wo 合同工作流',
  ).toBe(true);
});

test('workflow 详情停留时响应 runner state 文件变化', async ({ page }) => {
  await writeWorkflowState(
    LIVE_REFRESH_RUN_ID,
    LIVE_REFRESH_WORKFLOW_CHANGE,
    'running',
    'execution',
    '2026-06-11T08:05:00.000Z',
  );

  const projectList = await fetchJson(page.request, '/api/projects');
  expect(projectList.response.ok()).toBe(true);
  const project = projectList.json.find((entry) => entry.fullPath === PRIMARY_FIXTURE_PROJECT_PATH || entry.path === PRIMARY_FIXTURE_PROJECT_PATH);
  expect(project, '需要先从轻量项目清单中获得项目路由').toBeTruthy();

  const routePrefix = project.routePath || project.fullPath || project.path;
  await page.goto(`${routePrefix}/runs/${LIVE_REFRESH_RUN_ID}`, { waitUntil: 'networkidle' });
  await expect(page.getByText(`Go runner: ${LIVE_REFRESH_RUN_ID}`)).toBeVisible();
  await expect(page.getByText('状态: running')).toBeVisible();

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'workflow-detail-before-refresh.png'),
    fullPage: true,
  });

  await page.waitForTimeout(1200);
  await writeWorkflowState(
    LIVE_REFRESH_RUN_ID,
    LIVE_REFRESH_WORKFLOW_CHANGE,
    'done',
    'done',
    '2026-06-11T08:06:00.000Z',
  );

  await expect(page.getByText('状态: completed')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('阶段: done')).toBeVisible();
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'workflow-detail-after-refresh.png'),
    fullPage: true,
  });
});
