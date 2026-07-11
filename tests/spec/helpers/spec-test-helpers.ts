// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Shared Playwright helpers for OpenSpec acceptance tests.
 * These helpers authenticate the browser, prepare fixture workspaces, and
 * build realistic filesystem/git state under the isolated Playwright HOME.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import {
  ensurePlaywrightFixture,
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_PROJECT_PATHS,
} from '../../e2e/helpers/playwright-fixture.ts';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;
process.env.JWT_SECRET ||= 'spec-test-helpers-jwt-secret';

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../../backend/middleware/auth.ts'),
  import('../../../backend/database/db.ts'),
]);

export const PRIMARY_FIXTURE_LABEL = 'fixture-project';
export const PRIMARY_FIXTURE_PROJECT_PATH = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];

/**
 * Build a valid local auth token for the first active user in the isolated fixture DB.
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

export let AUTH_TOKEN: string;

try {
  AUTH_TOKEN = createLocalAuthToken();
} catch {
  // Playwright fixture DB not initialized — lazy-resolve in tests that need it
  AUTH_TOKEN = '';
}

/**
 * Resolve a path inside the primary workspace fixture.
 *
 * @param {string} relativePath
 * @returns {string}
 */
export function resolveFlowrkspacePath(relativePath) {
  return path.join(PRIMARY_FIXTURE_PROJECT_PATH, relativePath);
}

/**
 * Standard auth header set for API request assertions.
 *
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Record<string, string>}
 */
export function authHeaders(extraHeaders = {}) {
  return {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    ...extraHeaders,
  };
}

/**
 * Inject the local auth token before any page scripts run.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function authenticatePage(page) {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
  }, AUTH_TOKEN);
}

/**
 * Reset the primary workspace contents without touching the fixture session history.
 *
 * @returns {Promise<void>}
 */
export async function resetWorkspaceProject() {
  await fs.rm(PRIMARY_FIXTURE_PROJECT_PATH, { recursive: true, force: true });
  await fs.mkdir(PRIMARY_FIXTURE_PROJECT_PATH, { recursive: true });
}

/**
 * Write a UTF-8 text file into the workspace fixture.
 *
 * @param {string} relativePath
 * @param {string} content
 * @returns {Promise<void>}
 */
export async function writeWorkspaceTextFile(relativePath, content) {
  const absolutePath = resolveFlowrkspacePath(relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
}

/**
 * Write raw bytes into the workspace fixture.
 *
 * @param {string} relativePath
 * @param {Uint8Array | number[]} bytes
 * @returns {Promise<void>}
 */
export async function writeWorkspaceBinaryFile(relativePath, bytes) {
  const absolutePath = resolveFlowrkspacePath(relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, Buffer.from(bytes));
}

/**
 * Check whether a relative path exists in the workspace fixture.
 *
 * @param {string} relativePath
 * @returns {Promise<boolean>}
 */
export async function workspacePathExists(relativePath) {
  try {
    await fs.access(resolveFlowrkspacePath(relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a workspace file as raw bytes.
 *
 * @param {string} relativePath
 * @returns {Promise<Buffer>}
 */
export async function readWorkspaceBytes(relativePath) {
  return fs.readFile(resolveFlowrkspacePath(relativePath));
}

/**
 * Locate the encoded project record that matches the primary workspace path.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<{ name: string, fullPath: string }>}
 */
export async function getFixtureProject(request) {
  const response = await request.get('/api/projects', {
    headers: authHeaders(),
  });

  if (!response.ok()) {
    throw new Error(`Failed to list projects: ${response.status()}`);
  }

  const payload = await response.json();
  const project = Array.isArray(payload)
    ? payload.find((item) => item.fullPath === PRIMARY_FIXTURE_PROJECT_PATH)
    : null;

  if (!project) {
    throw new Error(`Could not find Playwright fixture project for ${PRIMARY_FIXTURE_PROJECT_PATH}`);
  }

  return project;
}

/**
 * Open the main shell and select the primary fixture project from the sidebar.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ reset?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function openFixtureProject(page, options = {}) {
  if (options.reset !== false) {
    ensurePlaywrightFixture({ preserveAuthDatabase: true });
  }
  await authenticatePage(page);

  // Before navigating, verify the Vite dev server is reachable.
  // Retry with backoff if it is still starting up or recovering from a previous
  // teardown/reload cycle (net::ERR_CONNECTION_REFUSED).
  const baseUrl = page.context()._options.baseURL || 'http://127.0.0.1:6174';
  for (let probe = 0; probe < 30; probe += 1) {
    try {
      const probeResponse = await fetch(baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(2_000) });
      if (probeResponse.ok || probeResponse.status < 500) break;
    } catch {
      // Server not ready yet — wait and retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  let isAuthenticated = false;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate((token) => {
        window.localStorage.setItem('auth-token', token);
      }, AUTH_TOKEN);
      await page.goto('/', { waitUntil: 'networkidle' });
    } catch (error) {
      if (attempt === 9) {
        throw error;
      }
      // Wait a bit before retry in case the server is recovering from a reload.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }

    try {
      await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0, { timeout: 1_000 });
    } catch {
      continue;
    }

    isAuthenticated = true;
    break;
  }

  if (!isAuthenticated) {
    await page.evaluate((token) => {
      window.localStorage.setItem('auth-token', token);
    }, AUTH_TOKEN);
    await page.reload({ waitUntil: 'networkidle' });
    isAuthenticated = await page.getByRole('button', { name: /sign in/i }).count() === 0;
  }

  await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^fixture-project\b/i }).first()).toBeVisible();
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
  await expect(page.locator('body')).not.toContainText('Loading...');
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
}

/**
 * Open the fixture manual session from the project overview card list.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function openFixtureManualSessionFromOverview(page) {
  await page
    .getByTestId('project-overview-manual-sessions')
    .getByRole('button', { name: /fixture-project manu/ })
    .first()
    .click();
}

/**
 * Switch the main content area to the Files tab.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function openFilesTab(page) {
  await page.getByRole('button', { name: /^Files$/i }).click();
}

/**
 * Execute a git command inside the fixture repository.
 *
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {string}
 */
export function git(args, cwd = PRIMARY_FIXTURE_PROJECT_PATH) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString('utf8').trim();
}

/**
 * Initialize a realistic git repository with local and remote branches.
 *
 * @returns {Promise<{ remotePath: string }>}
 */
export async function initGitWorkspaceFixture() {
  await resetWorkspaceProject();
  await writeWorkspaceTextFile('README.md', '# fixture-project fixture\n');
  await writeWorkspaceTextFile('src/app.js', 'export const app = "fixture";\n');

  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'playwright@example.com']);
  git(['config', 'user.name', 'Playwright']);
  git(['add', '.']);
  git(['commit', '-m', 'Initial commit']);

  const remotePath = path.join(path.dirname(PRIMARY_FIXTURE_PROJECT_PATH), 'fixture-project-remote.git');
  await fs.rm(remotePath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(remotePath), { recursive: true });
  git(['init', '--bare', remotePath], path.dirname(PRIMARY_FIXTURE_PROJECT_PATH));

  git(['remote', 'add', 'origin', remotePath]);
  git(['push', '-u', 'origin', 'main']);
  git(['checkout', '-b', 'feature/ui-panel']);
  git(['push', '-u', 'origin', 'feature/ui-panel']);
  git(['checkout', 'main']);
  git(['branch', 'stale-ui']);

  return { remotePath };
}

/**
 * Create one staged and one unstaged change in the current git fixture repo.
 *
 * @returns {Promise<void>}
 */
export async function createMixedGitChanges() {
  await writeWorkspaceTextFile('README.md', '# fixture-project fixture\n\nunstaged change\n');
  await writeWorkspaceTextFile('src/staged.js', 'export const staged = true;\n');
  git(['add', 'src/staged.js']);
}

/**
 * Break the origin remote so fetch operations fail in a predictable way.
 *
 * @returns {void}
 */
export function breakOriginRemote() {
  git(['remote', 'set-url', 'origin', 'https://invalid.example.invalid/ozw-fixture.git']);
}
