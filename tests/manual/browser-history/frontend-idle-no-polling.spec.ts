// @ts-nocheck -- proposal acceptance test; strict typing belongs to execution.
/**
 * PURPOSE: Verify a real logged-in browser session stays idle without repeating
 * business refresh requests or session-status WebSocket messages.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

let generateToken: (user: unknown) => string;
let userDb: { getFirstUser: () => unknown | null };
let AUTH_TOKEN: string;

test.beforeAll(async () => {
  process.env.DATABASE_PATH = path.join(process.env.HOME || '', '.ozw', 'auth.db');

  const [authModule, dbModule] = await Promise.all([
    import('../../../backend/middleware/auth.ts'),
    import('../../../backend/database/db.ts'),
  ]);
  generateToken = authModule.generateToken;
  userDb = dbModule.userDb;

  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }
  AUTH_TOKEN = generateToken(user);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
    window.localStorage.removeItem('ozw:workspace-layout:v1');
    window.localStorage.removeItem('activeTab');

    const originalSend = window.WebSocket.prototype.send;
    window.__ozwBusinessWsMessages = [];
    window.WebSocket.prototype.send = function patchedSend(payload) {
      try {
        const parsed = JSON.parse(String(payload));
        if (parsed?.type === 'check-session-status') {
          window.__ozwBusinessWsMessages.push({
            type: parsed.type,
            sessionId: parsed.sessionId || parsed.ozwSessionId || '',
            timestamp: Date.now(),
          });
        }
      } catch {
        // Non-JSON WebSocket frames are not business refresh messages.
      }
      return originalSend.call(this, payload);
    };
  }, AUTH_TOKEN);
});

async function openFixtureSession(page) {
  /**
   * Open a real fixture project session through the same route users visit.
   */
  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="workspace-dock-layout"]')).toBeVisible({ timeout: 10_000 });

  const sessionButton = page.locator('button', { hasText: /fixture-project manual-only session/ }).first();
  if (await sessionButton.isVisible().catch(() => false)) {
    await sessionButton.click();
  }

  await expect(page.getByPlaceholder('Type your message...')).toBeVisible({ timeout: 10_000 });
}

test('ordinary chat session stays idle without repeated business polling', async ({ page }) => {
  /**
   * A stable chat session may do initial loading, but after the baseline point it
   * must not keep asking for project lists or session status on a fixed cadence.
   */
  let projectListRequests = 0;
  await page.route('**/api/projects', async (route) => {
    projectListRequests += 1;
    await route.continue();
  });

  await openFixtureSession(page);
  await page.waitForTimeout(1_000);

  const baselineProjectRequests = projectListRequests;
  const baselineStatusChecks = await page.evaluate(() => window.__ozwBusinessWsMessages.length);
  const baselineNavigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);

  await page.waitForTimeout(8_500);

  expect(projectListRequests - baselineProjectRequests).toBe(0);
  expect(await page.evaluate(() => window.__ozwBusinessWsMessages.length)).toBe(baselineStatusChecks);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(baselineNavigationCount);
  await expect(page.getByPlaceholder('Type your message...')).toBeVisible();
});
