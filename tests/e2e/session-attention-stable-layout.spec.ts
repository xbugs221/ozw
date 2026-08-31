/**
 * 文件目的：验证首页待处理卡片的规整布局与静态浏览体验。
 * 业务意义：后台回复不会刷新或重排卡片，关键信息和操作始终一眼可见。
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_AUTH_DB } from './helpers/playwright-fixture.ts';

declare global {
  interface Window {
    __attentionBoardSocket?: WebSocket;
  }
}

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { db, userDb }, { providerSessionIndexDb }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
  import('../../backend/provider-session-index-store.ts'),
]);

const FULL_FIRST_REQUEST = '这是用户的完整首条请求，卡片不得按二十、五十或八十个字符提前裁短。\n第二行也必须完整显示。';
const FULL_LATEST_REQUEST = '这是用户的最新一条请求，中间的助手回复和历史请求都不在首页展开。\n但最新请求本身不能被截断。';

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
function indexLongTitleAttentionFixture(): void {
  /** 业务目的：让浏览器通过正式接口验证标题在数据链路中未被裁短。 */
  providerSessionIndexDb.upsert(db, {
    provider: 'codex',
    id: 'playwright-full-title-session',
    projectPath: '/tmp/playwright-full-title-project',
    title: '完整请求测试会话',
    summary: '完整请求测试会话',
    firstRequest: FULL_FIRST_REQUEST,
    latestRequest: FULL_LATEST_REQUEST,
    createdAt: '2036-07-23T00:00:00.000Z',
    lastActivity: '2036-07-23T00:00:00.000Z',
    filePath: '/tmp/playwright-full-title-session.jsonl',
    fileMtimeMs: 2_100_000_000_000,
  });
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
  indexLongTitleAttentionFixture();
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
