// @ts-nocheck -- Playwright fixture tests use runtime browser globals and isolated state.
/**
 * 文件目的：用真实浏览器路径验证 114 会话路由编号合同。
 * 业务意义：用户连续点击新建会话时，OZW 必须把 cN 当作本地 route id，并在刷新后恢复 route。
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  authenticatePage,
} from '../spec/helpers/spec-test-helpers.ts';
import {
  PLAYWRIGHT_FIXTURE_PROJECT_PATHS,
} from './helpers/playwright-fixture.ts';
import { getProjectLocalConfigPath } from '../../backend/project-config-store.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results', '114-session-route-numbering');
const ROUTE_NUMBERING_PROJECT_NAME = 'fixture-project';
const ROUTE_NUMBERING_PROJECT_PATH = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];

/**
 * 写入 114 专用项目和过期 route counter，模拟用户已有真实 provider 会话的项目。
 */
async function seedRouteNumberingProject(): Promise<{ projectPath: string; projectName: string }> {
  /**
   * PURPOSE: Seed an already indexed fixture project with stale route state so
   * the browser exercises manual session creation without DB setup noise.
   */
  const projectPath = ROUTE_NUMBERING_PROJECT_PATH;
  const projectConfigPath = getProjectLocalConfigPath(projectPath);

  await fs.mkdir(projectPath, { recursive: true });
  await fs.writeFile(path.join(projectPath, 'README.md'), '# route numbering 114\n', 'utf8');

  await fs.mkdir(path.dirname(projectConfigPath), { recursive: true });
  await fs.writeFile(projectConfigPath, `${JSON.stringify({
    schemaVersion: 2,
    chat: {
      1: {
        sessionId: 'codex-real-alpha',
        provider: 'codex',
        title: '已有 Codex 会话',
      },
      2: {
        sessionId: 'pi-real-beta',
        provider: 'pi',
        title: '已有 Pi 会话',
      },
    },
    manualSessionRouteCounter: 1,
  }, null, 2)}\n`, 'utf8');

  return { projectPath, projectName: ROUTE_NUMBERING_PROJECT_NAME };
}

/**
 * 读取项目本地配置，确认浏览器操作最终落到真实持久化文件。
 */
async function readProjectConfig(projectPath: string) {
  /**
   * PURPOSE: Inspect the persisted project config after browser actions so the
   * e2e verifies route/finalize state, not just visible DOM.
   */
  return JSON.parse(await fs.readFile(getProjectLocalConfigPath(projectPath), 'utf8'));
}

test('114 browser route numbering creates c3/c4 from stale counter and restores after refresh', async ({ page }) => {
  const { projectPath, projectName } = await seedRouteNumberingProject();
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  await page.addInitScript(() => {
    window.prompt = (_message, defaultValue = '') => defaultValue;
  });
  await authenticatePage(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  const manualSessionCreateBodies = [];
  await page.route('**/manual-sessions', async (route) => {
    const body = route.request().postDataJSON();
    manualSessionCreateBodies.push(body);
    await route.continue();
  });

  await page.getByTestId('project-list-item-fixture-project-desktop-surface').click();
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible();

  const manualSessionGroup = page.getByTestId('project-overview-manual-sessions').first();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-codex').click();
  await expect(page).toHaveURL(/\/workspace\/.*\/c3(?:\?.*)?$/, { timeout: 10_000 });
  expect(manualSessionCreateBodies[0]?.routeIndex).toBeUndefined();
  expect(manualSessionCreateBodies[0]?.label).toBe('');

  const configAfterFirstDraft = await readProjectConfig(projectPath);
  expect(configAfterFirstDraft.chat?.['3']?.sessionId).toBe('c3');
  expect(configAfterFirstDraft.chat?.['1']?.sessionId).toBe('codex-real-alpha');

  const finalizeResult = await page.evaluate(async ({ targetProjectName, targetProjectPath }) => {
    const token = window.localStorage.getItem('auth-token');
    const response = await fetch(`/api/projects/${encodeURIComponent(targetProjectName)}/manual-sessions/c3/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        actualSessionId: 'codex-e2e-real-c3',
        provider: 'codex',
        projectPath: targetProjectPath,
      }),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
    };
  }, { targetProjectName: projectName, targetProjectPath: projectPath });
  expect(finalizeResult).toEqual({
    ok: true,
    status: 200,
    body: { success: true, finalized: true },
  });

  await expect.poll(async () => {
    const config = await readProjectConfig(projectPath);
    return config.chat?.['3']?.providerSessionId;
  }, {
    timeout: 10_000,
  }).toBe('codex-e2e-real-c3');

  await page.getByTestId('project-list-item-fixture-project-desktop-surface').click();
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-pi').click();
  await expect(page).toHaveURL(/\/workspace\/.*\/c4(?:\?.*)?$/, { timeout: 10_000 });
  expect(manualSessionCreateBodies[1]?.routeIndex).toBeUndefined();
  expect(manualSessionCreateBodies[1]?.label).toBe('');

  const configAfterSecondDraft = await readProjectConfig(projectPath);
  expect(configAfterSecondDraft.chat?.['3']?.sessionId).toBe('c3');
  expect(configAfterSecondDraft.chat?.['3']?.providerSessionId).toBe('codex-e2e-real-c3');
  expect(configAfterSecondDraft.chat?.['4']?.sessionId).toBe('c4');
  expect(configAfterSecondDraft.manualSessionRouteCounter).toBe(4);

  await page.goto('/workspace/fixture-project/c3', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/workspace\/.*\/c3(?:\?.*)?$/, { timeout: 10_000 });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/workspace\/.*\/c3(?:\?.*)?$/, { timeout: 10_000 });
  await expect(page.locator('textarea[placeholder]').first()).toBeVisible();

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'browser-c3-restored-after-refresh.png'),
    fullPage: true,
  });
});
