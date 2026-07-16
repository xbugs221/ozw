/**
 * PURPOSE: Verify a real oz flow child session can reconnect through the
 * long-running server and render its bounded transcript snapshot.
 */
import path from 'node:path';

import { expect, test } from '@playwright/test';

const REAL_SESSION_URL = process.env.OZW_REAL_SESSION_URL
  || 'http://localhost:4001/projects/ald_proj/acwfvs-webui/runs/20260716T040253.460229542Z/sessions/fix_1';
const SCREENSHOT_PATH = path.join(
  process.cwd(),
  'docs/debug/20260716-1520-oz-flow-session-render/screenshots/after-render.png',
);

test('真实 oz flow 子会话可通过常驻服务渲染', async ({ page }) => {
  /** Exercise the exact user route with its real backend, auth, and transcript. */
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const initialHistory = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.includes('/sessions/019f692c-419d-7361-a67d-326d6ab7828d/messages')
      && url.searchParams.get('offset') === '0';
  });
  await page.goto(REAL_SESSION_URL, { waitUntil: 'domcontentloaded' });
  await initialHistory;
  await page.getByTestId('tab-chat').click();
  await expect(page.getByRole('heading', { name: '初修' })).toBeVisible();
  await page.getByTestId('tab-shell').click();
  await page.getByTestId('tab-chat').click();

  await expect(page.getByTestId('chat-rendered-snapshot-pane')).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect.poll(() => pageErrors).toEqual([]);
  await page.getByTestId('chat-rendered-snapshot-pane').screenshot({ path: SCREENSHOT_PATH });
});
