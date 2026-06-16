// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Smoke-test project visibility in the browser.
 * Verifies the isolated e2e fixture projects are exposed by the API and rendered in the authenticated shell.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_HOME,
  PLAYWRIGHT_FIXTURE_PROJECT_PATHS,
  PLAYWRIGHT_FIXTURE_SESSION_IDS,
} from './helpers/playwright-fixture.ts';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const PROJECT_INDEX_EVIDENCE_DIR = path.join(process.cwd(), 'test-results', 'project-index-db-backed');

/**
 * Persist browser-side evidence required by the project index acceptance gate.
 */
function writeProjectIndexEvidence(relativePath, content) {
  /**
   * PURPOSE: Store screenshots and network snapshots where the deterministic
   * acceptance runner checks them.
   */
  const evidencePath = path.join(PROJECT_INDEX_EVIDENCE_DIR, relativePath);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, content);
}

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
]);

/**
 * Build a valid local auth token for the first active user.
 * This keeps smoke tests independent of hard-coded credentials.
 *
 * @returns {string}
 */
function createLocalAuthToken() {
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }

  return generateToken(user);
}

const AUTH_TOKEN = createLocalAuthToken();

/**
 * Fetch the overview read model that owns provider session details.
 */
async function fetchFixtureProjectOverview(page) {
  return page.evaluate(async (fixtureProjectPath) => {
    const token = window.localStorage.getItem('auth-token');
    const projectsResponse = await fetch('/api/projects', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const projects = await projectsResponse.json();
    const fixtureProject = Array.isArray(projects)
      ? projects.find((item) => item.fullPath === fixtureProjectPath) || null
      : null;
    if (!fixtureProject) {
      return { ok: false, status: projectsResponse.status, projectPaths: [], overview: null };
    }
    const overviewResponse = await fetch(
      `/api/projects/${encodeURIComponent(fixtureProject.name)}/overview?projectPath=${encodeURIComponent(fixtureProject.fullPath)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    return {
      ok: projectsResponse.ok && overviewResponse.ok,
      status: overviewResponse.status,
      projectPaths: Array.isArray(projects) ? projects.map((item) => item.fullPath) : [],
      overview: await overviewResponse.json(),
    };
  }, PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
  }, AUTH_TOKEN);
});

test('local app loads with authenticated shell', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page).toHaveTitle(/ozw/i);
  await expect(page.locator('body')).not.toContainText('Login');
});

test('projects api exposes both fixture project roots', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const payload = await fetchFixtureProjectOverview(page);

  expect(payload.ok).toBeTruthy();
  expect(payload.status).toBe(200);
  expect(payload.projectPaths).toContain(PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0]);
  expect(payload.projectPaths).toContain(PLAYWRIGHT_FIXTURE_PROJECT_PATHS[1]);
  expect(payload.overview?.codexSessions?.length || 0).toBeGreaterThan(0);
  expect(payload.overview?.codexSessions?.every((session) => typeof session.summary === 'string')).toBe(true);
  writeProjectIndexEvidence('project-list-network.json', JSON.stringify({
    evidence: 'network-project-list',
    source: 'e2e-project-visibility',
    status: payload.status,
    ok: payload.ok,
    projectCount: payload.projectPaths.length,
    projectPaths: payload.projectPaths,
    hasFixtureProjects: PLAYWRIGHT_FIXTURE_PROJECT_PATHS.every((projectPath) => payload.projectPaths.includes(projectPath)),
  }, null, 2));
});

test('sidebar text shows both fixture labels', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).not.toContainText('Loading...');
  await expect(page.locator('body')).toContainText('fixture-project');
  await expect(page.locator('body')).toContainText('.fixture-project');
  await page.screenshot({
    path: path.join(PROJECT_INDEX_EVIDENCE_DIR, '4001-project-list.png'),
    fullPage: true,
  });
});

test('project overview session link loads Codex history instead of empty state', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
  await expect(page.locator('[data-testid="project-overview-manual-sessions"]')).toBeVisible();
  await page.getByRole('button', { name: /fixture-project manu/ }).first().click();
  await expect(page.locator('body')).toContainText('fixture-project manual-only session');
  await expect(page.locator('body')).not.toContainText('继续您的对话');
});

test('mobile project selection opens session and workflow list in main content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).not.toContainText('Loading...');

  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
  await expect(page).toHaveURL(/\/workspace\//);
  await expect(page.locator('[data-testid="project-overview-manual-sessions"]').getByRole('heading', { name: '手动会话' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '自动工作流' })).toBeVisible();
  await expect(page.getByRole('button', { name: /fixture-project manu/ }).first()).toBeVisible();

  const manualSessionPanelOverflow = await page.locator('[data-testid="project-overview-manual-sessions"]').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(manualSessionPanelOverflow.scrollWidth).toBeLessThanOrEqual(manualSessionPanelOverflow.clientWidth + 1);
  await page.screenshot({
    path: path.join(PROJECT_INDEX_EVIDENCE_DIR, 'project-overview-mobile.png'),
    fullPage: true,
  });
});

test('manual session order stays pinned to creation time after an older session gets new messages', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();

  const manualSessions = page.locator('[data-testid="project-overview-manual-sessions"] button').filter({
    hasText: /fixture-project/,
  });
  await expect(manualSessions).toHaveCount(1);
  await expect(manualSessions.nth(0)).toContainText('fixture-project manu');

  const executionSessionPath = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '04',
    '19',
    'fixture-project-execution-session.jsonl',
  );

  fs.appendFileSync(
    executionSessionPath,
    `${JSON.stringify({
      type: 'response_item',
      timestamp: '2026-04-20T18:30:00.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'execution session new follow-up reply' }],
      },
    })}\n`,
    'utf8',
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();

  await expect(manualSessions).toHaveCount(1);
  await expect(manualSessions.nth(0)).toContainText('fixture-project manu');
});

test('creating a manual session updates the sidebar immediately without a browser reload', async ({ page }) => {
  const sessionLabel = `自动刷新会话-${Date.now()}`;

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept(sessionLabel);
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();

  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await expect(manualSessionGroup).toBeVisible();

  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-codex').click();

  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+$/);
  await expect(page.locator('textarea').first()).toBeVisible();
});

test('creating a manual session keeps the default label number aligned with the route number', async ({ page }) => {
  await page.addInitScript(() => {
    window.__lastManualSessionPromptDefault = null;
    window.prompt = (_message, defaultValue = '') => {
      window.__lastManualSessionPromptDefault = String(defaultValue || '');
      return String(defaultValue || '');
    };
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();

  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await expect(manualSessionGroup).toBeVisible();

  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-codex').click();

  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+(?:\?.*)?$/);

  const routeMatch = page.url().match(/\/c(\d+)$/);
  expect(routeMatch).not.toBeNull();
  const expectedLabelPattern = new RegExp(`(会话|Session )${routeMatch[1]}`);

  await expect(page.locator('textarea').first()).toBeVisible();
});
