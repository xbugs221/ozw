/**
 * PURPOSE: Acceptance tests for production chat-search routing and response validation.
 * Derived from openspec/changes/3-fix-production-chat-search-routing/specs/chat-history-full-text-search/spec.md.
 */
import { test, expect } from '@playwright/test';
import {
  AUTH_TOKEN,
  authenticatePage,
} from './helpers/spec-test-helpers.ts';

const CHAT_SEARCH_INPUT = '[data-testid="chat-history-search-input"]';
const CHAT_SEARCH_RESULTS = '[data-testid="chat-history-search-results"]';
const CHAT_SEARCH_EMPTY = '[data-testid="chat-history-search-empty"]';
const CHAT_SEARCH_ERROR = '[data-testid="chat-history-search-error"]';
const OPEN_CHAT_SEARCH = '[data-testid="open-chat-history-search"]';

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
});

test('shows an explicit error when chat search returns HTML with HTTP 200', async ({ page }) => {
  /** Scenario: 搜索接口返回 HTML fallback 且状态码为 200 */
  await page.route('**/api/chat/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=UTF-8',
      body: '<!doctype html><html><head><title>ozw</title></head><body><div id=\"root\"></div></body></html>',
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await page.locator(CHAT_SEARCH_INPUT).fill('记忆');
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');

  await expect(page.locator(CHAT_SEARCH_RESULTS)).toBeVisible();
  await expect(page.locator(CHAT_SEARCH_ERROR)).toBeVisible();
  await expect(page.locator(CHAT_SEARCH_ERROR)).not.toContainText('No chat history matches found.');
  await expect(page.locator(CHAT_SEARCH_EMPTY)).toHaveCount(0);
});

test('returns fixture chat matches for an authenticated chat search request', async ({ request }) => {
  /** Scenario: 认证后的搜索请求返回真实会话搜索结果 */
  const response = await request.get('/api/chat/search?q=fixture-project%20session', {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });

  expect(response.ok()).toBe(true);
  expect((response.headers()['content-type'] || '')).toContain('application/json');

  const payload = await response.json();
  expect(typeof payload).toBe('object');
  expect(Array.isArray(payload.results)).toBe(true);
  expect(payload.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        provider: 'codex',
        sessionId: 'fixture-project-session',
        sessionSummary: 'Codex Session',
        snippet: expect.stringContaining('fixture-project session'),
      }),
    ]),
  );
});
