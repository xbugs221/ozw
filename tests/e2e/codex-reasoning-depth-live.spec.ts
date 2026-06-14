// @ts-nocheck -- Browser evidence test keeps assertions focused on user-visible behavior.
/**
 * PURPOSE: Verify an existing Codex session keeps a changed reasoning depth
 * visible immediately instead of reverting to stale selected-session metadata.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  authHeaders,
  getFixtureProject,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';

const DEBUG_DIR = path.join(process.cwd(), 'docs', 'debug', '20260604-0808-codex-reasoning-depth-live');
const SCREENSHOT_DIR = path.join(DEBUG_DIR, 'screenshots');
const SESSION_ID = 'fixture-project-manual-session';
const SESSION_TITLE_PATTERN = /fixture-project manu/i;

test('existing Codex session reasoning depth changes immediately without page refresh', async ({ page, request }) => {
  /**
   * Seed an old persisted depth, open the real manual-session page, change the
   * select, and assert the old selectedSession value does not overwrite it.
   */
  const modelStateRequests = [];
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  await openFixtureProject(page);
  const project = await getFixtureProject(request);
  await seedCodexReasoningEffort(request, project.name, 'medium');

  page.on('request', (httpRequest) => {
    if (httpRequest.method() !== 'PUT' || !httpRequest.url().includes('/model-state')) {
      return;
    }
    modelStateRequests.push(JSON.parse(httpRequest.postData() || '{}'));
  });

  await openFixtureProject(page, { reset: false });
  await page.getByTestId('project-overview-manual-sessions')
    .getByRole('button', { name: SESSION_TITLE_PATTERN })
    .first()
    .click();

  const depthSelect = page.getByTestId('session-depth-select');
  await expect(depthSelect).toBeVisible({ timeout: 20_000 });
  await expect(depthSelect).toHaveValue('medium', { timeout: 20_000 });

  await depthSelect.selectOption('low');
  await expect(depthSelect).toHaveValue('low');
  await expect.poll(() => modelStateRequests.some((entry) => entry.reasoningEffort === 'low')).toBe(true);
  await page.waitForTimeout(500);
  await expect(depthSelect).toHaveValue('low');
  await expect.poll(async () => {
    const response = await request.get(
      `/api/projects/${encodeURIComponent(project.name)}/sessions/${encodeURIComponent(SESSION_ID)}/model-state?projectPath=${encodeURIComponent(PRIMARY_FIXTURE_PROJECT_PATH)}`,
      { headers: authHeaders() },
    );
    const payload = await response.json();
    return payload?.state?.reasoningEffort || '';
  }).toBe('low');

  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'codex-reasoning-depth-live-low.png'),
    fullPage: true,
  });
});

async function seedCodexReasoningEffort(request, projectName, reasoningEffort) {
  /**
   * Persist a real session model-state value through the same API the UI uses.
   */
  const response = await request.put(
    `/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(SESSION_ID)}/model-state`,
    {
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      data: {
        projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
        provider: 'codex',
        model: 'gpt-5-codex',
        reasoningEffort,
      },
    },
  );
  expect(response.ok()).toBe(true);
}
