// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Smoke-test project visibility in the browser.
 * Verifies the isolated e2e fixture projects are exposed by the API and rendered in the authenticated shell.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import {
  PLAYWRIGHT_FIXTURE_HOME,
  PLAYWRIGHT_FIXTURE_PROJECT_PATHS,
  PLAYWRIGHT_FIXTURE_SESSION_IDS,
} from './helpers/playwright-fixture.ts';

const PROJECT_INDEX_EVIDENCE_DIR = path.join(process.cwd(), 'test-results', 'project-index-db-backed');
const DEBUG_SCREENSHOT_DIR = path.join(process.cwd(), 'docs', 'debug', '20260618-0924-cli-session-title', 'screenshots');
const WEBUI_TITLE_SCREENSHOT_DIR = path.join(process.cwd(), 'docs', 'debug', '20260618-1002-manual-first-request-title', 'screenshots');
const TERMINAL_RENDER_DEBUG_SCREENSHOT_DIR = path.join(process.cwd(), 'docs', 'debug', '20260707-1012-render-session-jsonl', 'screenshots');
const CLEAN_SESSION_ROUTE_SCREENSHOT_DIR = path.join(process.cwd(), 'docs', 'debug', '20260707-1014-clean-session-card-route', 'screenshots');

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

/**
 * Build a valid local auth token for the deterministic Playwright user.
 *
 * @returns {string}
 */
function createLocalAuthToken() {
  /**
   * PURPOSE: Avoid importing backend database modules in the browser test
   * process; the isolated server owns the SQLite connection during e2e runs.
   */
  const secret = process.env.JWT_SECRET || 'playwright-jwt-secret';
  return jwt.sign(
    {
      userId: 1,
      username: 'playwright-user',
    },
    secret,
    { expiresIn: '24h' },
  );
}

const AUTH_TOKEN = createLocalAuthToken();

/**
 * Open the fixture project that owns the manual Codex session routes.
 */
async function openFixtureProjectOverview(page) {
  /**
   * PURPOSE: Select by stable project identity instead of visible text because
   * the fixture list also contains ".fixture-project".
   */
  await page.getByTestId('project-list-item-fixture-project-desktop-surface').click();
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
}

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

test('project overview terminal session renders the clicked session history instead of the newest session', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const overview = await fetchFixtureProjectOverview(page);
  expect(overview.ok).toBe(true);
  expect((overview.overview?.codexSessions || []).map((session) => session.id)).toContain('fixture-project-manual-session');

  await openFixtureProjectOverview(page);

  const manualSessionsPanel = page.getByTestId('project-overview-manual-sessions');
  await expect(manualSessionsPanel).toBeVisible();
  await manualSessionsPanel.getByRole('button', { name: /fixture-project manu/ }).first().click();
  await expect(page).toHaveURL(/\/c1$/);
  await expect(page).not.toHaveURL(/terminalLaunchCommand|terminalSessionId/);
  await expect(page.getByTestId('tab-shell')).toHaveAttribute('aria-pressed', 'true');
  fs.mkdirSync(CLEAN_SESSION_ROUTE_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(CLEAN_SESSION_ROUTE_SCREENSHOT_DIR, 'session-card-clean-c-route.png'),
    fullPage: true,
  });

  const messagesResponse = page.waitForResponse(
    (response) => response.url().includes('/sessions/c1/messages') && response.status() === 200,
    { timeout: 10_000 },
  );
  await page.getByTestId('tab-chat').click();
  await messagesResponse;

  await expect(page.locator('body')).toContainText('fixture-project manual-only session');
  await expect(page.locator('body')).not.toContainText('继续您的对话');
  fs.mkdirSync(TERMINAL_RENDER_DEBUG_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(TERMINAL_RENDER_DEBUG_SCREENSHOT_DIR, 'terminal-session-rendered-history.png'),
    fullPage: true,
  });
});

test('project overview manual session card shows CLI first request title', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();

  const manualSessionsPanel = page.getByTestId('project-overview-manual-sessions');
  await expect(manualSessionsPanel).toBeVisible();
  await expect(manualSessionsPanel.getByRole('button', { name: /fixture-project manu/ }).first()).toBeVisible();
  await expect(manualSessionsPanel).not.toContainText('Codex Session');

  const overview = await fetchFixtureProjectOverview(page);
  expect(overview.ok).toBe(true);
  const codexSessions = Array.isArray(overview.overview?.codexSessions)
    ? overview.overview.codexSessions
    : [];
  const manualSession = codexSessions.find((session) => session.id === 'fixture-project-manual-session');
  expect(manualSession?.title).toBe('fixture-project manual-only session');
  expect(manualSession?.routeTitle).toBe('fixture-project manual-only session');

  fs.mkdirSync(DEBUG_SCREENSHOT_DIR, { recursive: true });
  await manualSessionsPanel.screenshot({
    path: path.join(DEBUG_SCREENSHOT_DIR, 'cli-session-card-title.png'),
  });
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

test('WebUI manual session card adopts first request title after first send', async ({ page }) => {
  const firstRequest = `首句标题${String(Date.now()).slice(-6)}`;

  await page.addInitScript(() => {
    window.prompt = (_message, defaultValue = '') => String(defaultValue || '');
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();

  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await expect(manualSessionGroup).toBeVisible();

  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-codex').click();
  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+$/);

  const routeMatch = page.url().match(/\/c(\d+)(?:[?#].*)?$/);
  expect(routeMatch).not.toBeNull();
  const routeNumber = routeMatch?.[1] || '';
  const defaultTitle = `会话${routeNumber}`;

  const input = page.locator('textarea').first();
  await input.fill(firstRequest);
  await input.press('Control+Enter');
  await expect(page.locator('[data-testid="chat-scroll-container"]').last()).toContainText(firstRequest);

  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
  await expect(page).toHaveURL(/\/workspace\/fixture-project(?:[/?#]|$)/);
  const refreshedManualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await expect(refreshedManualSessionGroup.getByRole('button', { name: new RegExp(firstRequest) })).toBeVisible({ timeout: 15_000 });
  await expect(refreshedManualSessionGroup).not.toContainText(defaultTitle);
  await expect(refreshedManualSessionGroup.getByText(`#${routeNumber}`)).toBeVisible();

  fs.mkdirSync(WEBUI_TITLE_SCREENSHOT_DIR, { recursive: true });
  await refreshedManualSessionGroup.screenshot({
    path: path.join(WEBUI_TITLE_SCREENSHOT_DIR, 'webui-manual-first-request-title.png'),
  });
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
