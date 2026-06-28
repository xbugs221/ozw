// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify browsing older history does not snap back to the latest tail
 * when the underlying session file receives an external update.
 */
import fs from 'node:fs';
import path from 'node:path';

import { test, expect } from '@playwright/test';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_HOME,
  PLAYWRIGHT_FIXTURE_PROJECT_PATHS,
  PLAYWRIGHT_FIXTURE_SESSION_IDS,
} from './helpers/playwright-fixture.ts';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
]);

const HISTORY_SCROLL_PROJECT_INDEX = 5;
const HISTORY_SCROLL_SESSION_ID = PLAYWRIGHT_FIXTURE_SESSION_IDS[HISTORY_SCROLL_PROJECT_INDEX];
const HISTORY_SCROLL_PROJECT_PATH = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[HISTORY_SCROLL_PROJECT_INDEX];
const MIXED_LONG_SESSION_ID = 'fixture-mixed-long-virtual-session';
const MIXED_LONG_PROJECT_PATH = HISTORY_SCROLL_PROJECT_PATH;
const MIXED_LONG_TARGET_TEXT = 'mixed long virtual target needle 520 inside a virtualized offscreen message';
const MIXED_LONG_TARGET_MESSAGE_KEY = `codex:${MIXED_LONG_SESSION_ID}:line:1041:msg:0`;
const MIXED_LONG_HIDDEN_CODE_TEXT = 'mixed long virtual full code line 090';
const MIXED_LONG_HIDDEN_DIFF_TEXT = 'new virtual diff final hidden line 220';
const MIXED_LONG_HIDDEN_TOOL_OUTPUT_TEXT = 'mixed long virtual full tool output hidden line 140';
const MIXED_LONG_HIDDEN_SUBAGENT_TEXT = 'mixed long virtual subagent child hidden output 25';
const HISTORY_PREFETCH_EVIDENCE_DIR = path.join(process.cwd(), 'test-results', 'history-prefetch');
const HISTORY_PREFETCH_NETWORK_PATH = path.join(HISTORY_PREFETCH_EVIDENCE_DIR, 'network.json');
const HISTORY_PREFETCH_SCROLL_STATE_PATH = path.join(HISTORY_PREFETCH_EVIDENCE_DIR, 'scroll-state.json');
const HISTORY_PREFETCH_ANCHOR_SCREENSHOT_PATH = path.join(HISTORY_PREFETCH_EVIDENCE_DIR, 'anchor-after-prepend.png');

/**
 * Persist local QA evidence for the history prefetch acceptance contract.
 *
 * @param {string} evidencePath
 * @param {unknown} evidence
 */
function writeHistoryPrefetchEvidence(evidencePath, evidence) {
  fs.mkdirSync(HISTORY_PREFETCH_EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

/**
 * Encode a project path the same way project API routes address project roots.
 *
 * @param {string} projectPath
 * @returns {string}
 */
function encodeClaudeProjectName(projectPath) {
  return projectPath.replace(/\//g, '-');
}

/**
 * Build a valid local auth token for the first active user.
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

/**
 * Append a new assistant message to the fixture session file to trigger `projects_updated`.
 *
 * @param {string} content
 */
function appendAssistantHistoryMessage(content = 'history scroll externally appended assistant turn') {
  const sessionDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '04',
    '19',
  );
  const sessionPath = path.join(sessionDir, `${HISTORY_SCROLL_SESSION_ID}.jsonl`);

  fs.appendFileSync(
    sessionPath,
    `${JSON.stringify({
      type: 'response_item',
      timestamp: '2026-04-19T01:30:00.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: content }],
      },
    })}\n`,
    'utf8',
  );
}


const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
  }, AUTH_TOKEN);
});

test('opening a history session starts at the latest messages', async ({ page }) => {
  await page.goto(`/session/${HISTORY_SCROLL_SESSION_ID}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  const scrollContainer = page.getByTestId('chat-scroll-container');
  await expect
    .poll(async () => scrollContainer.evaluate(
      (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
    ))
    .toBeLessThanOrEqual(4);
});

test('opening a long history session does not silently load the full transcript', async ({ page }) => {
  const messageRequests = [];
  await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
    messageRequests.push(route.request().url());
    await route.continue();
  });

  await page.goto(`/session/${HISTORY_SCROLL_SESSION_ID}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  const unboundedRequests = messageRequests.filter((url) => {
    const parsedUrl = new URL(url);
    return !parsedUrl.searchParams.has('limit') && !parsedUrl.searchParams.has('afterLine');
  });

  expect(unboundedRequests).toEqual([]);
  expect(messageRequests.some((url) => new URL(url).searchParams.get('limit') === '100')).toBe(true);
});

test('scrolling into the history prefetch zone loads older messages before the top', async ({ page }) => {
  const messageRequests = [];
  await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
    messageRequests.push(route.request().url());
    await route.continue();
  });

  await page.goto(`/session/${HISTORY_SCROLL_SESSION_ID}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  const scrollContainer = page.getByTestId('chat-scroll-container');
  const olderPageRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.includes('/messages')
      && url.searchParams.get('limit') === '100'
      && Number(url.searchParams.get('offset')) >= 100;
  }, { timeout: 5000 });
  const targetScrollTop = await scrollContainer.evaluate((element) => {
    const scrollableDistance = Math.max(0, element.scrollHeight - element.clientHeight);
    return Math.min(Math.max(240, Math.floor(element.clientHeight * 0.75)), Math.max(0, scrollableDistance - 8));
  });

  expect(targetScrollTop).toBeGreaterThan(100);
  const beforePrefetchState = await scrollContainer.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    visibleMessageKeys: Array.from(document.querySelectorAll('.chat-message'))
      .map((node) => node.getAttribute('data-message-key'))
      .filter(Boolean)
      .slice(0, 8),
    domMessageCount: document.querySelectorAll('.chat-message').length,
  }));
  await scrollContainer.evaluate((element, scrollTop) => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event('scroll'));
  }, targetScrollTop);

  const request = await olderPageRequest;
  const afterPrefetchState = await scrollContainer.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    visibleMessageKeys: Array.from(document.querySelectorAll('.chat-message'))
      .map((node) => node.getAttribute('data-message-key'))
      .filter(Boolean)
      .slice(0, 8),
    domMessageCount: document.querySelectorAll('.chat-message').length,
  }));
  const requestedUrl = new URL(request.url());
  expect(requestedUrl.searchParams.get('limit')).toBe('100');
  expect(Number(requestedUrl.searchParams.get('offset'))).toBeGreaterThanOrEqual(100);
  expect(messageRequests.every((url) => {
    const parsedUrl = new URL(url);
    return parsedUrl.searchParams.has('limit') || parsedUrl.searchParams.has('afterLine');
  })).toBe(true);
  writeHistoryPrefetchEvidence(HISTORY_PREFETCH_NETWORK_PATH, messageRequests.map((url) => {
    const parsedUrl = new URL(url);
    return {
      url,
      limit: parsedUrl.searchParams.get('limit'),
      offset: parsedUrl.searchParams.get('offset'),
      afterLine: parsedUrl.searchParams.get('afterLine'),
      cursor: parsedUrl.searchParams.get('cursor') || parsedUrl.searchParams.get('afterCursor'),
    };
  }));
  writeHistoryPrefetchEvidence(HISTORY_PREFETCH_SCROLL_STATE_PATH, {
    beforePrefetch: beforePrefetchState,
    targetScrollTop,
    afterPrefetch: afterPrefetchState,
  });
});

test('1000+ mixed long session keeps DOM bounded and search reveals offscreen target', async ({ page }) => {
  test.setTimeout(60_000);

  const messageRequests = [];
  await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
    messageRequests.push(route.request().url());
    await route.continue();
  });

  await page.goto(`/session/${MIXED_LONG_SESSION_ID}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('mixed long virtual markdown turn 1050');

  const unboundedRequests = messageRequests.filter((url) => {
    const parsedUrl = new URL(url);
    return !parsedUrl.searchParams.has('limit') && !parsedUrl.searchParams.has('afterLine');
  });
  expect(unboundedRequests).toEqual([]);
  await expect
    .poll(async () => page.locator('.chat-message').count())
    .toBeLessThanOrEqual(150);
  await expect(page.getByTestId('codex-tool-card')).toHaveCount(3);
  await expect(page.getByTestId('large-code-block-summary')).toBeVisible();
  await expect(page.getByText(MIXED_LONG_HIDDEN_CODE_TEXT)).toHaveCount(0);
  await expect(page.getByText(MIXED_LONG_HIDDEN_DIFF_TEXT)).toHaveCount(0);
  await expect(page.getByText(MIXED_LONG_HIDDEN_TOOL_OUTPUT_TEXT)).toHaveCount(0);
  await expect(page.getByText(MIXED_LONG_HIDDEN_SUBAGENT_TEXT)).toHaveCount(0);
  await expect(page.getByTestId('collapsible-lazy-content')).toHaveCount(0);

  const outputToolCard = page.getByTestId('codex-tool-card').filter({ hasText: 'write_stdin' });
  await outputToolCard.scrollIntoViewIfNeeded();
  await expect(outputToolCard).toHaveAttribute('data-collapsed', 'true');
  await outputToolCard.locator('summary').filter({ hasText: 'Output' }).click();
  await expect(outputToolCard.getByTestId('large-tool-output-summary')).toBeVisible();
  await expect(page.getByText(MIXED_LONG_HIDDEN_TOOL_OUTPUT_TEXT)).toHaveCount(0);
  await outputToolCard.getByRole('button', { name: /Show .* more lines/ }).click();
  await expect(page.getByText(MIXED_LONG_HIDDEN_TOOL_OUTPUT_TEXT)).toBeVisible();

  await expect
    .poll(async () => page.locator('.chat-message').count())
    .toBeLessThanOrEqual(150);

  await page.getByRole('button', { name: 'Show full code' }).click();
  await expect(page.getByText(MIXED_LONG_HIDDEN_CODE_TEXT)).toBeVisible();

  await page.evaluate(() => window.openChatHistorySearch?.());
  await page.route('**/api/chat/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        results: [{
          resultType: 'message',
          projectName: '',
          projectDisplayName: 'history-scroll',
          provider: 'codex',
          sessionId: MIXED_LONG_SESSION_ID,
          sessionSummary: 'Codex Session',
          messageKey: MIXED_LONG_TARGET_MESSAGE_KEY,
          snippet: MIXED_LONG_TARGET_TEXT,
          timestamp: '2026-04-17T08:40:40.000Z',
        }],
      }),
    });
  });
  await expect(page.getByTestId('chat-history-search-input')).toBeVisible();
  await page.getByTestId('chat-history-search-input').fill(MIXED_LONG_TARGET_TEXT);
  await page.getByTestId('chat-history-search-input').press('Enter');
  const result = page.getByTestId('chat-history-search-result').first();
  await expect(result).toContainText(MIXED_LONG_TARGET_TEXT);
  await result.click();

  const target = page.locator(`.chat-message[data-message-key="${MIXED_LONG_TARGET_MESSAGE_KEY}"]`);
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
  await expect
    .poll(async () => target.locator('.chat-search-highlight').count())
    .toBeGreaterThan(0);
  await expect(target.locator('.chat-search-highlight')).toContainText(
    MIXED_LONG_TARGET_TEXT,
  );
  await expect
    .poll(async () => page.locator('.chat-message').count())
    .toBeLessThanOrEqual(150);
});

test('scrolling up through history loads older messages', async ({ page }) => {
  await page.goto(`/session/${HISTORY_SCROLL_SESSION_ID}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  const scrollContainer = page.getByTestId('chat-scroll-container');
  await scrollContainer.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });

  // After prepending older history, the previous read anchor stays in view
  // instead of jumping to the top of the newly loaded page.
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 12');
  await expect
    .poll(async () => scrollContainer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
});

test('scrolling to the top preserves the read anchor after older history prepends', async ({ page }) => {
  await page.goto(`/session/${HISTORY_SCROLL_SESSION_ID}`, { waitUntil: 'networkidle' });
  const scrollContainer = page.getByTestId('chat-scroll-container');
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  await scrollContainer.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });

  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 12');
  await expect
    .poll(async () => scrollContainer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 31');
  fs.mkdirSync(HISTORY_PREFETCH_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: HISTORY_PREFETCH_ANCHOR_SCREENSHOT_PATH, fullPage: false });
});

test('external append while scrolled up does not force bottom follow', async ({ page }) => {
  const appendedText = `history scroll externally appended while reading ${Date.now()}`;
  const projectsResponse = await page.request.get('/api/projects', {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  const projects = await projectsResponse.json();
  const project = projects.find((entry) => entry.fullPath === HISTORY_SCROLL_PROJECT_PATH);
  expect(project, `history-scroll project must be discoverable at ${HISTORY_SCROLL_PROJECT_PATH}`).toBeTruthy();

  const overviewResponse = await page.request.get(
    `/api/projects/${encodeURIComponent(project.name)}/overview?projectPath=${encodeURIComponent(HISTORY_SCROLL_PROJECT_PATH)}`,
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
  );
  const overview = await overviewResponse.json();
  const session = (overview.codexSessions || []).find((entry) => entry.providerSessionId === HISTORY_SCROLL_SESSION_ID || entry.id === HISTORY_SCROLL_SESSION_ID);
  expect(session?.routeIndex, 'history-scroll fixture session must have a cN route index').toBeTruthy();

  const messageRequests = [];
  await page.route(/\/api\/(?:projects\/.*\/sessions\/c\d+|codex\/sessions\/.*)\/messages.*/, async (route) => {
    messageRequests.push(route.request().url());
    await route.continue();
  });

  await page.goto(`${project.routePath}/c${session.routeIndex}`, { waitUntil: 'networkidle' });
  const scrollContainer = page.getByTestId('chat-scroll-container');
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  await scrollContainer.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 12');
  await page.waitForTimeout(500);
  const distanceBeforeAppend = await scrollContainer.evaluate(
    (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
  );

  appendAssistantHistoryMessage(appendedText);
  await page.waitForTimeout(1500);
  const distanceAfterAppend = await scrollContainer.evaluate(
    (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
  );

  expect(messageRequests.some((url) => new URL(url).searchParams.has('afterLine'))).toBe(true);
  expect(distanceAfterAppend).toBeGreaterThanOrEqual(Math.max(1, distanceBeforeAppend - 4));

  await scrollContainer.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByText(appendedText)).toBeVisible();
});

test('external append on project cN route renders without manual refresh', async ({ page }) => {
  const appendedText = `history scroll live appended on cN route ${Date.now()}`;
  const projectsResponse = await page.request.get('/api/projects', {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  const projects = await projectsResponse.json();
  const project = projects.find((entry) => entry.fullPath === HISTORY_SCROLL_PROJECT_PATH);
  expect(project, `history-scroll project must be discoverable at ${HISTORY_SCROLL_PROJECT_PATH}`).toBeTruthy();

  const overviewResponse = await page.request.get(
    `/api/projects/${encodeURIComponent(project.name)}/overview?projectPath=${encodeURIComponent(HISTORY_SCROLL_PROJECT_PATH)}`,
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
  );
  const overview = await overviewResponse.json();
  const session = (overview.codexSessions || []).find((entry) => entry.providerSessionId === HISTORY_SCROLL_SESSION_ID || entry.id === HISTORY_SCROLL_SESSION_ID);
  expect(session?.routeIndex, 'history-scroll fixture session must have a cN route index').toBeTruthy();

  const messageRequests = [];
  await page.route(/\/api\/(?:projects\/.*\/sessions\/c\d+|codex\/sessions\/.*)\/messages.*/, async (route) => {
    messageRequests.push(route.request().url());
    await route.continue();
  });

  await page.goto(`${project.routePath}/c${session.routeIndex}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  appendAssistantHistoryMessage(appendedText);
  await expect(page.getByText(appendedText)).toBeVisible({ timeout: 10_000 });
  expect(messageRequests.some((url) => new URL(url).searchParams.has('afterLine'))).toBe(true);
});

// This test appends to the fixture file, so it must run after the scroll test above.
test('afterLine API returns only new messages appended after the known count', async ({ request }) => {
  const projectName = encodeClaudeProjectName(HISTORY_SCROLL_PROJECT_PATH);

  // Fetch initial total
  const initialResp = await request.get(
    `/api/projects/${projectName}/sessions/${HISTORY_SCROLL_SESSION_ID}/messages?limit=100&offset=0`,
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
  );
  const initial = await initialResp.json();
  const knownTotal = initial.total;

  appendAssistantHistoryMessage();

  // Use afterLine to fetch only new messages
  const incrResp = await request.get(
    `/api/projects/${projectName}/sessions/${HISTORY_SCROLL_SESSION_ID}/messages?afterLine=${knownTotal}`,
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
  );
  const incremental = await incrResp.json();

  expect(incremental.total).toBe(knownTotal + 1);
  expect(incremental.messages).toHaveLength(1);
  expect(incremental.messages[0].message.content).toBe('history scroll externally appended assistant turn');
});
