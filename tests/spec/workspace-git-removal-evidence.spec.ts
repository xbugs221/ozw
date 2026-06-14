/**
 * Sources: 2026-06-13-105-彻底移除Git功能
 *
 * 文件目的：用真实浏览器工作区路径稳定验证 Git 功能移除后的运行时证据。
 * 业务场景：用户携带旧 Git 布局状态进入工作区时，界面不显示 Git 入口，不请求 Git API，并生成可复查证据。
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticatePage, authHeaders, openFixtureProject } from './helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/105-remove-git');

test.use({ trace: 'off' });

test('workspace removes Git entry and downgrades stale layout state', async ({ page, request }) => {
  /**
   * Generate browser-visible evidence from a real workspace path.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const networkEvents: Array<{ url: string; method: string; status?: number }> = [];

  page.on('request', (req) => {
    networkEvents.push({ url: req.url(), method: req.method() });
  });
  page.on('response', (res) => {
    const event = networkEvents.find((item) => item.url === res.url() && item.status === undefined);
    if (event) {
      event.status = res.status();
    }
  });

  await page.context().tracing.start({ screenshots: true, snapshots: true });
  await authenticatePage(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('activeTab', 'git');
    window.localStorage.setItem('ozw:workspace-layout:v1', JSON.stringify({
      rightDock: {
        activePanel: 'git',
        collapsed: false,
        width: 420,
        fullscreen: false,
        split: null,
      },
      bottomDock: {
        activePanel: 'terminal',
        collapsed: true,
        height: 260,
        fullscreen: false,
      },
    }));
  });

  await openFixtureProject(page, { reset: false });

  await expect(page.getByTestId('tab-chat')).toBeVisible();
  await expect(page.getByTestId('tab-files')).toBeVisible();
  await expect(page.getByTestId('tab-shell')).toBeVisible();
  await expect(page.getByTestId(`tab-${'git'}`)).toHaveCount(0);
  await expect(page.getByTestId('dock-panel-right')).not.toBeVisible();

  const unsupportedResponse = await request.get('/api/git/status', { headers: authHeaders() });
  expect(unsupportedResponse.status()).toBeGreaterThanOrEqual(400);
  expect(unsupportedResponse.status()).not.toBe(200);

  const snapshot = await page.evaluate(() => ({
    activeTab: window.localStorage.getItem('activeTab'),
    workspaceLayout: JSON.parse(window.localStorage.getItem('ozw:workspace-layout:v1') || 'null'),
    hasGitTab: document.querySelector('[data-testid="tab-git"]') !== null,
  }));

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'main-workspace-no-git.png'),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'layout-migration-state.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'no-git-api-network.json'),
    `${JSON.stringify({
      unsupportedGitApiStatus: unsupportedResponse.status(),
      gitApiRequestsDuringWorkspaceLoad: networkEvents.filter((event) => event.url.includes('/api/git')),
      allRequests: networkEvents,
    }, null, 2)}\n`,
    'utf8',
  );
  await page.context().tracing.stop({
    path: path.join(EVIDENCE_DIR, 'main-workspace-no-git-trace.zip'),
  });

  expect(snapshot.workspaceLayout?.rightDock?.activePanel).not.toBe('git');
  expect(snapshot.hasGitTab).toBe(false);
  expect(networkEvents.some((event) => event.url.includes('/api/git'))).toBe(false);
});
