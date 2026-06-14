// @ts-nocheck
/**
 * PURPOSE: Verify that after a session page finishes initial loading,
 * no repeat network requests occur for messages, token-usage, model-state,
 * or commands/list during 5 seconds of idle time.
 *
 * Aligned with spec.md:41-46: "真实会话页 5 秒空闲网络稳定性"
 */
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';

const KEY_ENDPOINTS = ['messages', 'token-usage', 'model-state', 'commands/list'];
const IDLE_SECONDS = 5;

/**
 * Normalize a URL path for endpoint grouping.
 * Collapses session IDs and project paths into placeholders
 * so the same logical endpoint across different sessions/projects
 * is counted together.
 */
function normalizeEndpoint(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const normalized = parts.map((p) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(p) || /^c\d+$/.test(p) ? ':sid' : p,
    );
    return normalized.join('/');
  } catch {
    return url;
  }
}

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
});

test('session page does not repeat key API requests during 5 idle seconds', async ({ page }) => {
  test.setTimeout(60_000);

  await openFixtureProject(page);

  // Find and click a manual session to enter session view
  const manualPanel = page.getByTestId('project-overview-manual-sessions');
  await expect(manualPanel).toBeVisible({ timeout: 10_000 });

  const sessionButton = manualPanel.getByRole('button').filter({ hasText: /#\d/ }).first();
  await expect(sessionButton).toBeVisible({ timeout: 10_000 });
  await sessionButton.click();

  // Wait for the session page to fully load
  await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible({ timeout: 15_000 });

  // Allow all initial data fetching (messages, token-usage, model-state,
  // slash commands) to complete
  await page.waitForTimeout(4000);

  // --- Start 5-second idle monitoring ---
  // The spec requires zero key endpoint requests during idle — not just
  // "no more than one per endpoint". Any request to messages, token-usage,
  // model-state, or commands/list after initial load violates the contract.
  const requestCounts = {};
  const consoleErrors = [];
  let monitoringActive = true;

  page.on('request', (request) => {
    if (!monitoringActive) return;
    const key = normalizeEndpoint(request.url());
    if (!key) return;
    for (const ep of KEY_ENDPOINTS) {
      if (key.includes(ep)) {
        requestCounts[key] = (requestCounts[key] || 0) + 1;
        break;
      }
    }
  });

  page.on('console', (msg) => {
    if (!monitoringActive) return;
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Idle for 5 seconds
  await page.waitForTimeout(IDLE_SECONDS * 1000);
  monitoringActive = false;

  // --- Verify ---
  // Report for audit trail (visible in test output)
  console.log('[Session idle network] Request counts during 5s idle:', JSON.stringify(requestCounts));
  if (consoleErrors.length > 0) {
    console.error('[Session idle console] Errors during 5s idle:', consoleErrors);
  } else {
    console.log('[Session idle console] No console errors during idle.');
  }

  const requestedEndpoints = Object.keys(requestCounts);
  const violations = [];
  for (const ep of requestedEndpoints) {
    violations.push(`${ep}: ${requestCounts[ep]} request(s)`);
  }

  if (violations.length > 0) {
    console.error('[Session idle network] VIOLATIONS:', violations);
  } else {
    console.log('[Session idle network] No key endpoint requests during idle.');
  }

  // Assert: zero key endpoint requests during the 5-second idle window
  expect(requestedEndpoints,
    `Key endpoint requests during 5s idle: ${violations.join(', ') || 'none'}`,
  ).toHaveLength(0);

  // Assert: no console errors during idle (e.g. favicon 404, connection failures)
  expect(consoleErrors,
    `Console errors during 5s idle: ${consoleErrors.join('; ') || 'none'}`,
  ).toHaveLength(0);
});
