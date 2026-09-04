/**
 * 文件目的：验证首页待处理卡片的规整布局与静态浏览体验。
 * 业务意义：后台回复不会刷新或重排卡片，关键信息和操作始终一眼可见。
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_HOME,
} from './helpers/playwright-fixture.ts';

declare global {
  interface Window {
    __attentionBoardSocket?: WebSocket;
  }
}

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }, { indexProviderSessionFile }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
  import('../../backend/domains/projects/project-domain-service.ts'),
]);

const FULL_FIRST_REQUEST = '这是用户的完整首条请求，卡片不得按二十、五十或八十个字符提前裁短。\n第二行也必须完整显示。';
const FULL_LATEST_REQUEST = '这是用户的最新一条请求，中间的助手回复和历史请求都不在首页展开。\n但最新请求本身不能被截断。';
const FULL_REQUEST_TRANSCRIPT_DIR = path.join(PLAYWRIGHT_FIXTURE_HOME, 'attention-card-transcript');
const FULL_REQUEST_TRANSCRIPT_PATH = path.join(FULL_REQUEST_TRANSCRIPT_DIR, 'playwright-full-title-session.jsonl');

test.afterAll(async () => {
  /** 业务目的：测试结束后不在系统临时目录留下会话转录。 */
  await fs.rm(FULL_REQUEST_TRANSCRIPT_DIR, { recursive: true, force: true });
});

/**
 * 创建隔离测试用户的浏览器登录令牌。
 */
function createLocalAuthToken(): string {
  /** 业务目的：通过真实认证入口访问首页看板。 */
  const user = userDb.getFirstUser();
  if (!user) throw new Error('No active user found for Playwright authentication');
  return generateToken(user);
}

/**
 * 写入一条完整长标题的真实 Provider 索引记录。
 */
async function indexLongTitleAttentionFixture(): Promise<void> {
  /** 业务目的：从真实转录文件进入快速索引，覆盖首尾请求的数据传递。 */
  await fs.mkdir(FULL_REQUEST_TRANSCRIPT_DIR, { recursive: true });
  await fs.writeFile(FULL_REQUEST_TRANSCRIPT_PATH, [
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2036-07-23T00:00:00.000Z',
      payload: { id: 'playwright-full-title-session', cwd: '/tmp/playwright-full-title-project' },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2036-07-23T00:00:01.000Z',
      payload: { type: 'user_message', message: FULL_FIRST_REQUEST },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2036-07-23T00:00:02.000Z',
      payload: { type: 'agent_message', message: '中间回复不会在卡片中展开。' },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2036-07-23T00:00:03.000Z',
      payload: { type: 'user_message', message: FULL_LATEST_REQUEST },
    }),
  ].join('\n') + '\n', 'utf8');
  await indexProviderSessionFile('codex', FULL_REQUEST_TRANSCRIPT_PATH);
}

/**
 * 向真实浏览器连接注入服务端同格式的失效消息。
 */
async function triggerSessionInvalidation(page: Page): Promise<void> {
  /** 业务目的：稳定触发前端失效链，同时保留真实认证与真实待处理接口。 */
  await page.evaluate(() => {
    window.__attentionBoardSocket?.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'session_changed',
        provider: 'codex',
        sessionId: 'fixture-project-session',
        timestamp: new Date().toISOString(),
      }),
    }));
  });
}

test('待处理卡片完整显示首尾请求且右滑直接完成', async ({ page }) => {
  /**
   * 通过真实首页和认证接口检查卡片几何，再注入服务端同格式失效消息。
   */
  const browserIssues: string[] = [];
  page.on('console', (message) => {
    /** 渲染过程不应产生与应用相关的警告或错误。 */
    if (message.type() === 'error' || message.type() === 'warning') browserIssues.push(message.text());
  });
  page.on('pageerror', (error) => browserIssues.push(error.message));
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.addInitScript((token) => {
    /** 保存应用创建的真实 WebSocket，测试仅注入服务端同格式事件。 */
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class TestWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        window.__attentionBoardSocket = this;
      }
    };
    window.localStorage.setItem('auth-token', token);
  }, createLocalAuthToken());
  await indexLongTitleAttentionFixture();
  await page.goto('/', { waitUntil: 'networkidle' });
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page).toHaveTitle(/\S+/);

  const board = page.getByTestId('session-attention-board');
  await expect(board).toBeVisible();
  await expect.poll(() => board.locator('[data-testid^="session-attention-card-"]').count()).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => window.__attentionBoardSocket?.readyState)).toBe(1);

  const firstCard = board.locator('[data-testid^="session-attention-card-"]').first();
  const cardBox = await firstCard.boundingBox();
  const boardBox = await board.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(boardBox).not.toBeNull();
  expect(cardBox!.width).toBeGreaterThan(boardBox!.width - 50);
  await expect(firstCard.getByText(FULL_FIRST_REQUEST, { exact: true })).toBeVisible();
  await expect(firstCard.getByText(FULL_LATEST_REQUEST, { exact: true })).toBeVisible();
  await expect(firstCard.getByText('...', { exact: true })).toBeVisible();
  await expect(firstCard.locator('time[data-slot="session-attention-time"]')).toHaveAttribute(
    'datetime',
    '2036-07-23T00:00:03.000Z',
  );
  await expect(firstCard.locator('[title="codex"]')).toHaveCount(0);
  await expect(firstCard.getByText('首条请求', { exact: true })).toHaveCount(0);
  await expect(firstCard.getByText('最新请求', { exact: true })).toHaveCount(0);
  const singleRequestCard = board.locator('[data-testid^="session-attention-card-"]')
    .filter({ hasText: 'alpha fixture session' }).first();
  await expect(singleRequestCard.getByText('...', { exact: true })).toHaveCount(0);
  await expect(board.getByRole('button', { name: '全部处理完成' })).toBeVisible();
  await expect(firstCard.getByRole('checkbox')).toHaveCount(0);

  const cardTestId = await firstCard.getAttribute('data-testid');
  const sessionId = String(cardTestId || '')
    .replace('session-attention-card-', '')
    .split(':')
    .slice(1)
    .join(':');
  expect(sessionId).not.toBe('');
  expect(await firstCard.textContent()).not.toContain(sessionId);

  const beforeEvent = await board.evaluate((element) => {
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    element.scrollTop = Math.min(320, maxScrollTop);
    element.dispatchEvent(new Event('scroll'));
    return { maxScrollTop, scrollTop: element.scrollTop };
  });
  expect(beforeEvent.maxScrollTop).toBeGreaterThan(160);
  expect(beforeEvent.scrollTop).toBeGreaterThan(100);

  let attentionRefreshes = 0;
  page.on('request', (request) => {
    /** 失效事件之后不应再次读取看板。 */
    if (request.url().includes('/api/session-attention?limit=100')) attentionRefreshes += 1;
  });
  await triggerSessionInvalidation(page);
  await page.waitForTimeout(250);

  expect(attentionRefreshes).toBe(0);
  expect(await board.evaluate((element) => element.scrollTop)).toBe(beforeEvent.scrollTop);
  await board.evaluate((element) => {
    /** 截图回到看板顶部，完整呈现标题和首张卡片。 */
    element.scrollTop = 0;
  });
  const beforeHandledCount = await board.locator('[data-testid^="session-attention-card-"]').count();
  const swipeBox = await firstCard.boundingBox();
  expect(swipeBox).not.toBeNull();
  await page.mouse.move(swipeBox!.x + 30, swipeBox!.y + 35);
  await page.mouse.down();
  await page.mouse.move(swipeBox!.x + 210, swipeBox!.y + 35, { steps: 8 });
  await expect(firstCard).toHaveAttribute('data-swipe-state', 'swiping');
  await page.mouse.up();
  await expect(board.locator('[data-testid^="session-attention-card-"]')).toHaveCount(beforeHandledCount - 1);

  const keyboardCard = board.locator('[data-testid^="session-attention-card-"]').first();
  await keyboardCard.focus();
  await page.keyboard.press('ArrowRight');
  await expect(board.locator('[data-testid^="session-attention-card-"]')).toHaveCount(beforeHandledCount - 2);
  const relevantBrowserIssues = browserIssues.filter((issue) => (
    !issue.includes('React Router Future Flag Warning')
    && !issue.includes('WebSocket is closed before the connection is established')
    && !issue.includes('WebSocket disconnected before it was ready')
  ));
  expect(relevantBrowserIssues).toEqual([]);
});
