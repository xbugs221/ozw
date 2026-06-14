// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify desktop workspace dock width does not shrink away from the
 * main content edge in real project routes.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(process.env.HOME || '', '.ozw', 'auth.db');

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../../backend/middleware/auth.ts'),
  import('../../../backend/database/db.ts'),
]);

function createLocalAuthToken() {
  /**
   * Create an auth token from the isolated Playwright fixture user.
   */
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }
  return generateToken(user);
}

const AUTH_TOKEN = createLocalAuthToken();

test.use({ viewport: { width: 1920, height: 1080 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
    window.localStorage.removeItem('ozw:workspace-layout:v1');
    window.localStorage.removeItem('activeTab');
  }, AUTH_TOKEN);
});

async function openProjectHome(page) {
  /**
   * Open the fixture project homepage, which also uses the dock shell.
   */
  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="workspace-dock-layout"]')).toBeVisible({ timeout: 10_000 });
}

async function openRightDock(page) {
  /**
   * Open the auxiliary files dock explicitly; desktop no longer opens it by default.
   */
  await page.locator('[data-testid="tab-files"]').click();
  await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible({ timeout: 10_000 });
}

async function openProjectSession(page) {
  /**
   * Open a real fixture project session inside the dock workspace.
   */
  await openProjectHome(page);
  const sessionButton = page.locator('button', { hasText: /fixture-project manual-only session/ }).first();
  await expect(sessionButton).toBeVisible({ timeout: 10_000 });
  await sessionButton.click();
  await openRightDock(page);
}

async function box(locator, name) {
  /**
   * Return a visible element bounding box or fail with the business target name.
   */
  const value = await locator.boundingBox();
  if (!value) {
    throw new Error(`Expected ${name} to have a bounding box`);
  }
  return value;
}

async function readWorkspaceBoxes(page) {
  /**
   * Read the layout boxes needed to prove the right dock is attached to the workspace edge.
   */
  const workspace = await box(page.locator('[data-testid="workspace-dock-layout"]'), 'workspace dock layout');
  const rightDock = await box(page.locator('[data-testid="dock-panel-right"]'), 'right dock');
  const center = await box(page.locator('[data-testid="workspace-dock-layout"] > div').first(), 'center area');
  return { workspace, rightDock, center };
}

async function dragHandle(page, locator, deltaX, deltaY) {
  /**
   * Drag a resize handle by a real mouse movement.
   */
  const rect = await box(locator, 'resize handle');
  const startX = rect.x + rect.width / 2;
  const startY = rect.y + rect.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

function rightEdge(rect) {
  /**
   * Compute a DOMRect-like right edge from Playwright's bounding box shape.
   */
  return rect.x + rect.width;
}

function expectEdgesAligned(actual, expected, tolerance = 8) {
  /**
   * Compare layout edges while allowing browser pixel rounding.
   */
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test('project session dock fills desktop workspace width', async ({ page }) => {
  await openProjectSession(page);

  const { workspace, rightDock, center } = await readWorkspaceBoxes(page);
  expect(workspace.width).toBeGreaterThan(1500);
  expect(center.width).toBeGreaterThan(900);
  expectEdgesAligned(rightEdge(rightDock), rightEdge(workspace));
});

test('right dock resize keeps the right edge attached', async ({ page }) => {
  await openProjectSession(page);

  const handle = page.locator('[data-testid="resize-handle-vertical"]');
  const initial = await readWorkspaceBoxes(page);

  await dragHandle(page, handle, -120, 0);
  const wider = await readWorkspaceBoxes(page);
  expect(wider.rightDock.width).toBeGreaterThan(initial.rightDock.width + 80);
  expect(wider.rightDock.x).toBeLessThan(initial.rightDock.x - 80);
  expectEdgesAligned(rightEdge(wider.rightDock), rightEdge(wider.workspace));
  expectEdgesAligned(rightEdge(wider.rightDock), rightEdge(initial.rightDock));
  expect(wider.center.width).toBeGreaterThan(700);

  await dragHandle(page, handle, 90, 0);
  const narrower = await readWorkspaceBoxes(page);
  expect(narrower.rightDock.width).toBeLessThan(wider.rightDock.width - 60);
  expect(narrower.rightDock.x).toBeGreaterThan(wider.rightDock.x + 60);
  expectEdgesAligned(rightEdge(narrower.rightDock), rightEdge(narrower.workspace));
});

test('project homepage dock also fills desktop workspace width', async ({ page }) => {
  await openProjectHome(page);
  await openRightDock(page);

  const { workspace, rightDock, center } = await readWorkspaceBoxes(page);
  expect(workspace.width).toBeGreaterThan(1500);
  expect(center.width).toBeGreaterThan(900);
  expectEdgesAligned(rightEdge(rightDock), rightEdge(workspace));
});
