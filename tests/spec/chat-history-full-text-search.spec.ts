// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Acceptance tests for cross-session full-text chat history search.
 * Derived from openspec/changes/1-add-chat-history-full-text-search/specs/chat-history-full-text-search/spec.md.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.ts';
import { resolveFlowRunStatePath } from '../../backend/domains/workflows/flow-runtime-paths.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  openFixtureProject,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.ts';

const CHAT_SEARCH_INPUT = '[data-testid="chat-history-search-input"]';
const CHAT_SEARCH_RESULTS = '[data-testid="chat-history-search-results"]';
const CHAT_SEARCH_RESULT = '[data-testid="chat-history-search-result"]';
const CHAT_SEARCH_MODE_CONTENT = '[data-testid="chat-history-search-mode-content"]';
const CHAT_SEARCH_MODE_JSONL = '[data-testid="chat-history-search-mode-jsonl"]';
const OPEN_CHAT_SEARCH = '[data-testid="open-chat-history-search"]';
const CHAT_SEARCH_HIGHLIGHT = '.chat-search-highlight';

/**
 * Write one Codex JSONL session file under the Playwright fixture HOME.
 *
 * @param {{
 *   sessionId: string,
 *   entries: Array<Record<string, unknown>>,
 * }} params
 * @returns {Promise<void>}
 */
async function writeCodexSession({ sessionId, entries }) {
  const codexDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '04',
    '14',
  );
  const sessionPath = path.join(codexDir, `${sessionId}.jsonl`);

  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

/**
 * Write one Codex JSONL fixture with a custom JSONL basename.
 *
 * @param {{
 *   fileName: string,
 *   entries: Array<Record<string, unknown>>,
 * }} params
 * @returns {Promise<void>}
 */
async function writeCodexSessionFile({ fileName, entries }) {
  const codexDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '04',
    '30',
  );
  const sessionPath = path.join(codexDir, fileName);

  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

/**
 * Update the fixture wo state so JSONL search can prove runner-owned routing.
 *
 * @param {string} thread
 * @returns {Promise<void>}
 */
async function pointFixtureWorkflowExecutionAtThread(thread) {
  const statePath = resolveFlowRunStatePath(PRIMARY_FIXTURE_PROJECT_PATH, 'run-fixture');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const processes = Array.isArray(state.processes)
    ? state.processes.map((process) => (
      process.stage === 'execution' ? { ...process, sessionId: thread } : process
    ))
    : [];
  await fs.writeFile(
    statePath,
    `${JSON.stringify({
      ...state,
      sessions: {
        ...(state.sessions || {}),
        execution: thread,
      },
      processes,
    }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Build a minimal Codex transcript that the current parser can read.
 *
 * @param {{
 *   sessionId: string,
 *   records: Array<Record<string, unknown>>
 * }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildCodexTranscript({ sessionId, records }) {
  return [
    {
      timestamp: '2026-04-14T09:00:00.000Z',
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
 * @param {{
 *   sessionId: string,
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>,
 *   startedAt?: string,
 * }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildCodexChatTranscript({ sessionId, messages, startedAt = '2026-04-14T09:00:00.000Z' }) {
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
 * @param {'content' | 'jsonl'} [mode]
 * @returns {Promise<import('@playwright/test').Locator>}
 */
async function runChatSearch(page, query, mode = 'content') {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await expect(page.locator(CHAT_SEARCH_MODE_JSONL)).toBeVisible();
  await expect(page.locator(CHAT_SEARCH_MODE_CONTENT)).toBeVisible();
  await page.locator(mode === 'jsonl' ? CHAT_SEARCH_MODE_JSONL : CHAT_SEARCH_MODE_CONTENT).click();
  await expect(page.locator(CHAT_SEARCH_INPUT)).toBeVisible();
  await page.locator(CHAT_SEARCH_INPUT).fill(query);
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');
  await expect(page.locator(CHAT_SEARCH_RESULTS)).toBeVisible();
  return page.locator(CHAT_SEARCH_RESULT);
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('returns a hit when the keyword only exists in an older Codex assistant message', async ({ page }) => {
  /** Scenario: 关键词命中旧 Codex 会话中的助手消息 */
  const sessionId = 'codex-search-assistant-hit';
  const keyword = 'needle-codex-assistant-legacy';

  await writeCodexSession({
    sessionId,
    entries: buildCodexChatTranscript({
      sessionId,
      messages: [
        { role: 'user', content: 'Please help me review the previous implementation.' },
        { role: 'assistant', content: `The hidden reference is ${keyword} and only appears in this old reply.` },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(1);
  await expect(results.filter({ hasText: /Codex/i })).toHaveCount(1);
});

test('returns a hit when the keyword only exists in a Codex user message', async ({ page }) => {
  /** Scenario: 关键词命中 Codex 会话中的用户消息 */
  const sessionId = 'codex-search-user-hit';
  const keyword = 'needle-codex-user-only';

  await writeCodexSession({
    sessionId,
    entries: buildCodexTranscript({
      sessionId,
      records: [
        {
          timestamp: '2026-04-14T09:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: `Remember this term: ${keyword}`,
          },
        },
        {
          timestamp: '2026-04-14T09:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Acknowledged.' }],
          },
        },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(1);
  await expect(results.filter({ hasText: /Codex/i })).toHaveCount(1);
});

test('returns hits for visible reasoning or tool text in the transcript', async ({ page }) => {
  /** Scenario: 关键词命中 transcript 中的工具或 reasoning 文本 */
  const sessionId = 'codex-search-reasoning-hit';
  const keyword = 'needle-reasoning-visible';

  await writeCodexSession({
    sessionId,
    entries: buildCodexTranscript({
      sessionId,
      records: [
        {
          timestamp: '2026-04-14T09:10:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Find the relevant note.',
          },
        },
        {
          timestamp: '2026-04-14T09:10:02.000Z',
          type: 'response_item',
          payload: {
            type: 'reasoning',
            summary: [{ text: `Reasoning summary contains ${keyword} for audit purposes.` }],
          },
        },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(1);
});

test('returns separate message-level results when the same keyword hits multiple sessions', async ({ page }) => {
  /** Scenario: 同一关键词命中多个会话 */
  const keyword = 'needle-multi-session';

  await writeCodexSession({
    sessionId: 'codex-multi-session-a',
    entries: buildCodexChatTranscript({
      sessionId: 'codex-multi-session-a',
      messages: [
        { role: 'user', content: 'Session A request.' },
        { role: 'assistant', content: `A result mentions ${keyword} in Codex.` },
      ],
    }),
  });

  await writeCodexSession({
    sessionId: 'codex-multi-session-b',
    entries: buildCodexTranscript({
      sessionId: 'codex-multi-session-b',
      records: [
        {
          timestamp: '2026-04-14T09:20:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Session B request.',
          },
        },
        {
          timestamp: '2026-04-14T09:20:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: `Codex also stores ${keyword} here.` }],
          },
        },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(2);
});

test('returns separate message-level results when the same keyword appears in multiple messages of one session', async ({ page }) => {
  /** Scenario: 同一会话中同词命中多条消息 */
  const sessionId = 'codex-same-session-multi-hit';
  const keyword = 'needle-same-session-many';

  await writeCodexSession({
    sessionId,
    entries: buildCodexChatTranscript({
      sessionId,
      messages: [
        { role: 'user', content: 'Initial request without the keyword.' },
        { role: 'assistant', content: `First answer contains ${keyword}.` },
        { role: 'user', content: 'Follow-up.' },
        { role: 'assistant', content: `Second answer also contains ${keyword}.` },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(2);
});

test('clicking a search result scrolls directly to a hit that is already loaded', async ({ page }) => {
  /** Scenario: 命中消息已在当前加载窗口中 */
  const sessionId = 'codex-click-loaded-hit';
  const keyword = 'needle-click-loaded';
  const targetText = `The loaded hit contains ${keyword} and should be immediately visible.`;

  await writeCodexSession({
    sessionId,
    entries: buildCodexChatTranscript({
      sessionId,
      messages: [
        { role: 'user', content: 'Show the latest item.' },
        { role: 'assistant', content: targetText },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);
  await results.filter({ hasText: keyword }).first().click();

  const targetMessage = page.locator('.chat-message').filter({ hasText: targetText }).first();
  await expect(targetMessage).toBeVisible();
  await expect(targetMessage).toBeInViewport();
});

test('clicking a search result auto-loads older history until the hit message is available', async ({ page }) => {
  /** Scenario: 命中消息不在当前加载窗口中 */
  const sessionId = 'codex-click-unloaded-hit';
  const keyword = 'needle-click-unloaded';
  const messages = [{ role: 'user', content: 'Start session.' }];

  for (let index = 0; index < 12; index += 1) {
    messages.push({
      role: index === 2 ? 'assistant' : 'user',
      content: index === 2
        ? `Older hidden target contains ${keyword} and requires loading more history.`
        : `Filler message ${index}`,
    });
  }

  await writeCodexSession({
    sessionId,
    entries: buildCodexChatTranscript({ sessionId, messages }),
  });

  const results = await runChatSearch(page, keyword);
  await results.filter({ hasText: keyword }).first().click();

  const targetMessage = page.locator('.chat-message').filter({ hasText: keyword }).first();
  await expect(targetMessage).toBeVisible();
  await expect(targetMessage).toBeInViewport();
});

test('opening a search result highlights every match occurrence inside the target message', async ({ page }) => {
  /** Scenario: 搜索结果打开后高亮命中词 */
  /** Scenario: 同一条消息中关键词出现多次 */
  const sessionId = 'codex-highlight-repeated-hit';
  const keyword = 'needle-highlight-repeat';
  const repeatedMessage = `${keyword} appears here, and ${keyword} appears again in the same reply.`;

  await writeCodexSession({
    sessionId,
    entries: buildCodexChatTranscript({
      sessionId,
      messages: [
        { role: 'user', content: repeatedMessage },
        { role: 'assistant', content: 'Opened the highlighted request.' },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);
  await results.filter({ hasText: keyword }).first().click();

  const targetMessage = page.locator('.chat-message').filter({ hasText: repeatedMessage }).first();
  await expect(targetMessage).toBeVisible();
  await expect(targetMessage.locator(CHAT_SEARCH_HIGHLIGHT)).toHaveCount(2);
});

test('search mode choices are visible before submitting a chat-history search', async ({ page }) => {
  /** Scenario: 用户必须选择搜索模式 */
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(OPEN_CHAT_SEARCH).first().click();

  await expect(page.locator(CHAT_SEARCH_MODE_JSONL)).toHaveText('JSONL 文件名/thread');
  await expect(page.locator(CHAT_SEARCH_MODE_CONTENT)).toHaveText('文件内容');
  await expect(page.locator(CHAT_SEARCH_INPUT)).toHaveAttribute('placeholder', /JSONL 文件名或 thread/);
});

test('JSONL file name search opens Codex rollout thread without message targeting', async ({ page }) => {
  /** Scenario: 搜索 Codex rollout 文件名中的 thread 段 */
  /** Scenario: 搜索完整 Codex JSONL 文件名 */
  /** Scenario: 会话级 thread 命中可以打开目标会话 */
  const thread = '019dda10-ba67-7973-ac49-3ae9102d38cd';
  const fileName = `rollout-2026-04-30T00-27-02-${thread}.jsonl`;

  await writeCodexSessionFile({
    fileName,
    entries: buildCodexTranscript({
      sessionId: 'payload-id-that-is-not-the-resume-thread',
      records: [
        {
          timestamp: '2026-04-30T00:27:03.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'This body intentionally omits the rollout thread token.',
          },
        },
      ],
    }),
  });

  const threadResults = await runChatSearch(page, thread, 'jsonl');
  await expect(threadResults.filter({ hasText: thread })).toHaveCount(1);
  await expect(threadResults.filter({ hasText: fileName })).toHaveCount(1);

  const fileNameResults = await runChatSearch(page, fileName, 'jsonl');
  await expect(fileNameResults.filter({ hasText: thread })).toHaveCount(1);

  await threadResults.first().click();
  await expect(page).toHaveURL(/\/workspace\/fixture-project\/c\d+$/);
  await expect(page).not.toHaveURL(/messageKey=/);
  await expect(page.getByText(thread, { exact: true })).toBeVisible();
  await expect(page.getByText('codex --dangerously-bypass-approvals-and-sandbox')).toHaveCount(0);
});

test('content search does not match Codex rollout thread when only the file name contains it', async ({ page }) => {
  /** Scenario: 文件内容模式不匹配 JSONL 文件名 */
  const thread = '119dda10-ba67-7973-ac49-3ae9102d38cd';

  await writeCodexSessionFile({
    fileName: `rollout-2026-04-30T00-27-02-${thread}.jsonl`,
    entries: buildCodexTranscript({
      sessionId: 'payload-id-for-content-isolation',
      records: [
        {
          timestamp: '2026-04-30T00:27:03.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'The transcript has useful content but no rollout identifier.',
          },
        },
      ],
    }),
  });

  await runChatSearch(page, thread, 'content');
  await expect(page.locator('[data-testid="chat-history-search-empty"]')).toBeVisible();
});

test('search mode keeps same thread token separated between JSONL and content results', async ({ page }) => {
  /** Scenario: 同一字符串在不同模式下分别命中不同来源 */
  const token = 'shared-thread-and-message-token';

  await writeCodexSessionFile({
    fileName: `rollout-2026-04-30T00-27-02-${token}.jsonl`,
    entries: buildCodexTranscript({
      sessionId: 'payload-id-for-shared-token',
      records: [
        {
          timestamp: '2026-04-30T00:27:03.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: `A visible message also contains ${token}.`,
          },
        },
      ],
    }),
  });

  const jsonlResults = await runChatSearch(page, token, 'jsonl');
  await expect(jsonlResults).toHaveCount(1);
  await expect(jsonlResults.first()).toContainText(`thread: ${token}`);

  const contentResults = await runChatSearch(page, token, 'content');
  await expect(contentResults).toHaveCount(1);
  await expect(contentResults.first()).not.toContainText(`thread: ${token}`);
});

test('JSONL thread search opens a workflow child session when the runner owns the thread', async ({ page }) => {
  /** Scenario: workflow runner 输出的 thread 可被搜索打开 */
  const thread = 'codex-runner-execution-thread';

  await openFixtureProject(page);
  await pointFixtureWorkflowExecutionAtThread(thread);
  await page.reload({ waitUntil: 'networkidle' });
  await writeCodexSessionFile({
    fileName: `${thread}.jsonl`,
    entries: buildCodexTranscript({
      sessionId: thread,
      records: [
        {
          timestamp: '2026-04-30T00:27:03.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Runner-owned Codex transcript for workflow navigation.',
          },
        },
      ],
    }),
  });

  await page.locator(OPEN_CHAT_SEARCH).first().click();
  await page.locator(CHAT_SEARCH_MODE_JSONL).click();
  await page.locator(CHAT_SEARCH_INPUT).fill(thread);
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');
  const results = page.locator(CHAT_SEARCH_RESULT);
  await expect(results.filter({ hasText: thread })).toHaveCount(1);

  await results.first().click();
  await expect(page).toHaveURL(/\/workspace\/fixture-project\/runs\/run-fixture\/sessions\/execution$/);
});
