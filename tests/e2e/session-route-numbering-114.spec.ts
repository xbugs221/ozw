// @ts-nocheck -- Playwright fixture tests use runtime browser globals and isolated state.
/**
 * 文件目的：用真实浏览器路径验证 114 会话路由编号合同。
 * 业务意义：用户连续点击新建会话时，CBW 必须把 cN 当作本地 route id，并在刷新后恢复 route。
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  authenticatePage,
} from '../spec/helpers/spec-test-helpers.ts';
import {
  ensurePlaywrightFixture,
  PLAYWRIGHT_FIXTURE_HOME,
} from './helpers/playwright-fixture.ts';
import { getProjectLocalConfigPath } from '../../backend/project-config-store.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results', '114-session-route-numbering');

/**
 * 计算全局项目配置里的手动项目 key，保持与 e2e fixture 的项目发现格式一致。
 */
function encodeFixtureProjectName(projectPath: string): string {
  /**
   * PURPOSE: Match the fixture's manual project key encoding so the browser can
   * discover this project through the normal /api/projects path.
   */
  return projectPath.replace(/[\\/:\s~_]/g, '-');
}

/**
 * 写入 114 专用项目和过期 route counter，模拟用户已有真实 provider 会话的项目。
 */
async function seedRouteNumberingProject(): Promise<{ projectPath: string; projectName: string }> {
  /**
   * PURPOSE: Seed the isolated browser HOME with real ozw config files so the
   * browser exercises the production project discovery and save paths.
   */
  const projectPath = path.join(PLAYWRIGHT_FIXTURE_HOME, 'workspace', 'route-numbering-114');
  const projectName = encodeFixtureProjectName(projectPath);
  const globalConfigPath = getProjectLocalConfigPath('');
  const projectConfigPath = getProjectLocalConfigPath(projectPath);

  await fs.mkdir(projectPath, { recursive: true });
  await fs.writeFile(path.join(projectPath, 'README.md'), '# route numbering 114\n', 'utf8');

  let globalConfig = {};
  try {
    globalConfig = JSON.parse(await fs.readFile(globalConfigPath, 'utf8'));
  } catch {
    globalConfig = {};
  }
  globalConfig[projectName] = {
    manuallyAdded: true,
    originalPath: projectPath,
    displayName: 'route-numbering-114',
  };
  await fs.mkdir(path.dirname(globalConfigPath), { recursive: true });
  await fs.writeFile(globalConfigPath, `${JSON.stringify(globalConfig, null, 2)}\n`, 'utf8');

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

  return { projectPath, projectName };
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

test.beforeEach(async () => {
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
});

test('114 browser route numbering creates c3/c4 from stale counter and restores after refresh', async ({ page }) => {
  const { projectPath, projectName } = await seedRouteNumberingProject();
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  await page.addInitScript(() => {
    window.prompt = (_message, defaultValue = '') => defaultValue;
  });
  await authenticatePage(page);
  await page.goto('/', { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: /^route-numbering-114\b/i }).click();
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible();

  const manualSessionGroup = page.getByTestId('project-overview-manual-sessions').first();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-codex').click();
  await expect(page).toHaveURL(/\/workspace\/.*\/c3(?:\?.*)?$/, { timeout: 10_000 });

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
    return config.chat?.['3']?.sessionId;
  }, {
    timeout: 10_000,
  }).toBe('codex-e2e-real-c3');

  await page.getByRole('button', { name: /^route-numbering-114\b/i }).click();
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-pi').click();
  await expect(page).toHaveURL(/\/workspace\/.*\/c4(?:\?.*)?$/, { timeout: 10_000 });

  const configAfterSecondDraft = await readProjectConfig(projectPath);
  expect(configAfterSecondDraft.chat?.['3']?.sessionId).toBe('codex-e2e-real-c3');
  expect(configAfterSecondDraft.chat?.['4']?.sessionId).toBe('c4');
  expect(configAfterSecondDraft.manualSessionRouteCounter).toBe(4);

  await page.goto('/workspace/route-numbering-114/c3', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/workspace\/.*\/c3(?:\?.*)?$/, { timeout: 10_000 });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/workspace\/.*\/c3(?:\?.*)?$/, { timeout: 10_000 });
  await expect(page.locator('textarea[placeholder]').first()).toBeVisible();

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'browser-c3-restored-after-refresh.png'),
    fullPage: true,
  });
});
