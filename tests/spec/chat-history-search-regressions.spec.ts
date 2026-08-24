// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Acceptance tests for chat history search regression fixes.
 * Derived from openspec/changes/archive/2026-04-15-11-fix-chat-history-search-regressions/specs/chat-history-full-text-search/spec.md.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  openFixtureProject,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.ts';

const CHAT_SEARCH_INPUT = '[data-testid="chat-history-search-input"]';
const CHAT_SEARCH_RESULTS = '[data-testid="chat-history-search-results"]';
const CHAT_SEARCH_RESULT = '[data-testid="chat-history-search-result"]';
const CHAT_SEARCH_LOADING = '[data-testid="chat-history-search-loading"]';
const CHAT_SEARCH_EMPTY = '[data-testid="chat-history-search-empty"]';
const CHAT_SEARCH_ERROR = '[data-testid="chat-history-search-error"]';
const CHAT_SEARCH_HIGHLIGHT = '[data-testid="chat-history-search-highlight"]';
const OPEN_CHAT_SEARCH = '[data-testid="open-chat-history-search"]';
const CHAT_SEARCH_MODE_CONTENT = '[data-testid="chat-history-search-mode-content"]';

/**
 * Write one Codex JSONL session file under the Playwright fixture HOME.
 *
 * @param {{ sessionId: string, entries: Array<Record<string, unknown>>, datePath?: string[] }} params
 * @returns {Promise<void>}
 */
async function writeCodexSession({ sessionId, entries, datePath = ['2026', '04', '15'] }) {
  const codexDir = path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', ...datePath);
  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(
    path.join(codexDir, `${sessionId}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

/**
 * Build a minimal Codex transcript that the current parser can read.
 *
 * @param {{ sessionId: string, records: Array<Record<string, unknown>> }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildCodexTranscript({ sessionId, records }) {
  return [
    {
      timestamp: '2026-04-15T09:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        model: 'gpt-5.5',
      },
    },
    ...records,
  ];
}

/**
 * Build a Codex chat transcript from user and assistant messages.
 *
 * @param {{ sessionId: string, startedAt?: string, messages: Array<{ role: 'user' | 'assistant', content: string }> }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildCodexChatTranscript({ sessionId, startedAt = '2026-04-15T09:00:00.000Z', messages }) {
  const base = new Date(startedAt).getTime();
  return buildCodexTranscript({
    sessionId,
    records: messages.map((message, index) => {
      const timestamp = new Date(base + index * 1000).toISOString();
      if (message.role === 'user') {
        return {
          timestamp,
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: message.content,
          },
        };
      }

      return {
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: message.content }],
        },
      };
    }),
  });
}

/**
 * Run a global chat-history search and return the result rows locator.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} query
 * @returns {Promise<import('@playwright/test').Locator>}
 */
async function runChatSearch(page, query) {
  await openFixtureProject(page, { reset: false });
  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await expect(page.locator(CHAT_SEARCH_INPUT)).toBeVisible();
  await page.locator(CHAT_SEARCH_MODE_CONTENT).click();
  await page.locator(CHAT_SEARCH_INPUT).fill(query);
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');
  return page.locator(CHAT_SEARCH_RESULT);
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('returns a hit when the keyword only exists in the sixth visible Codex session', async ({ page }) => {
  /** Scenario: 关键词仅存在于某项目第六个及之后的 Codex 可见会话 */
  const keyword = 'needle-codex-visible-session-six';

  for (let index = 0; index < 6; index += 1) {
    const sessionId = `codex-search-window-${index}`;
    await writeCodexSession({
      sessionId,
      entries: buildCodexChatTranscript({
        sessionId,
        startedAt: `2026-04-15T09:0${index}:00.000Z`,
        messages: [
          { role: 'user', content: `Session ${index} request.` },
          {
            role: 'assistant',
            content: index === 0
              ? `Only the oldest visible session contains ${keyword}.`
              : `Filler response ${index}.`,
          },
        ],
      }),
    });
  }

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(1);
});

test('opens an orphan Codex search result even when the session is not present in the current project cache', async ({ page }) => {
  /** Scenario: 搜索结果对应的 Codex 会话不在当前项目列表缓存中 */
  const sessionId = 'codex-orphan-search-hit';
  const keyword = 'needle-codex-orphan-hit';
  const targetText = `Detached Codex history stores ${keyword} in this reply.`;

  await writeCodexSession({
    sessionId,
    datePath: ['2025', '12', '31'],
    entries: buildCodexTranscript({
      sessionId,
      records: [
        {
          timestamp: '2026-04-15T09:10:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Recover this detached session.',
          },
        },
        {
          timestamp: '2026-04-15T09:10:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: targetText }],
          },
        },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);
  await results.filter({ hasText: keyword }).first().click();

  await expect(page.locator('.chat-message').filter({ hasText: targetText }).first()).toBeVisible();
});

test('shows a visible loading state while chat search is in flight', async ({ page }) => {
  /** Scenario: 搜索请求进行中 */
  await page.route('**/api/chat/search**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, results: [] }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await page.locator(CHAT_SEARCH_INPUT).fill('needle-loading-state');
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');

  await expect(page.locator(CHAT_SEARCH_LOADING)).toBeVisible();
});

test('shows an explicit empty state when chat search returns no matches', async ({ page }) => {
  /** Scenario: 搜索无命中 */
  await page.route('**/api/chat/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, results: [] }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await page.locator(CHAT_SEARCH_INPUT).fill('needle-empty-state');
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');

  await expect(page.locator(CHAT_SEARCH_EMPTY)).toBeVisible();
});

test('shows an explicit error state when chat search fails', async ({ page }) => {
  /** Scenario: 搜索请求失败 */
  await page.route('**/api/chat/search**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'fixture search failure' }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await page.locator(CHAT_SEARCH_INPUT).fill('needle-error-state');
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');

  await expect(page.locator(CHAT_SEARCH_ERROR)).toContainText('fixture search failure');
});

test('automatically scopes a two-character search to the selected project path', async ({ page }) => {
  /** Scenario: 当前项目中的两字符输入应自动触发项目范围搜索，无需按 Enter。 */
  await openFixtureProject(page, { reset: false });
  const searchRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/chat/search' && url.searchParams.get('q') === 'xy';
  });

  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await page.locator(CHAT_SEARCH_INPUT).fill('xy');

  const request = await searchRequest;
  const url = new URL(request.url());
  expect(url.searchParams.get('projectPath')).toBe(PRIMARY_FIXTURE_PROJECT_PATH);
  expect(url.searchParams.get('limit')).toBe('50');
});

test('does not let a slow older search overwrite newer results', async ({ page }) => {
  /** Scenario: 用户继续输入后，旧请求即使更晚返回也不能覆盖新结果。 */
  await page.route('**/api/chat/search**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'old-query') await new Promise((resolve) => setTimeout(resolve, 700));
    const resultText = query === 'old-query' ? 'stale-result' : 'fresh-result';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          resultType: 'session',
          projectName: 'fixture-project',
          projectDisplayName: 'fixture-project',
          provider: 'codex',
          sessionId: resultText,
          sessionSummary: resultText,
          snippet: resultText,
        }],
      }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await page.locator(CHAT_SEARCH_INPUT).fill('old-query');
  await expect(page.locator(CHAT_SEARCH_LOADING)).toBeVisible();
  await page.locator(CHAT_SEARCH_INPUT).fill('new-query');

  await expect(page.locator(CHAT_SEARCH_RESULT).filter({ hasText: 'fresh-result' })).toHaveCount(1);
  await page.waitForTimeout(800);
  await expect(page.locator(CHAT_SEARCH_RESULT).filter({ hasText: 'stale-result' })).toHaveCount(0);
});

test('renders matched text with readable surrounding context and session identity', async ({ page }) => {
  /** Scenario: 命中词、前后文和会话文件必须能在结果卡片中被一眼区分。 */
  await page.route('**/api/chat/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          resultType: 'message',
          projectName: 'ozw',
          projectDisplayName: 'ozw',
          provider: 'codex',
          sessionId: 'readable-result-session',
          sessionFileName: 'rollout-readable-result.jsonl',
          sessionSummary: '搜索体验改进',
          messageKey: 'message:readable-result',
          snippet: '在根目录创建测试集，并同步更新验收文件，确保搜索结果能展示完整上下文。',
        }],
      }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await page.locator(CHAT_SEARCH_MODE_CONTENT).click();
  await page.locator(CHAT_SEARCH_INPUT).fill('测试集');

  const result = page.locator(CHAT_SEARCH_RESULT);
  await expect(result).toContainText('rollout-readable-result.jsonl');
  await expect(result).toContainText('在根目录创建测试集，并同步更新验收文件');
  await expect(result.locator(CHAT_SEARCH_HIGHLIGHT)).toHaveText('测试集');
});
