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
process.env.JWT_SECRET ||= 'session-attention-scroll-preservation-secret';

const [{ generateToken }, { db, userDb }, { providerSessionIndexDb }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
  import('../../backend/provider-session-index-store.ts'),
]);

const LONG_ATTENTION_TITLE = '这是一个来自真实待处理接口的完整超长会话标题，用来验证后端不会再按二十、五十或八十个字符提前裁短，浏览器应当收到全部文字并仅在视觉上显示两行。'.repeat(3);

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
    title: LONG_ATTENTION_TITLE,
    summary: LONG_ATTENTION_TITLE,
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

test('待处理卡片使用完成勾选框且后台回复不会触发刷新', async ({ page }) => {
  /**
   * 通过真实首页和认证接口检查卡片几何，再注入服务端同格式失效消息。
   */
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

  const board = page.getByTestId('session-attention-board');
  await expect(board).toBeVisible();
  await expect.poll(() => board.locator('[data-testid^="session-attention-card-"]').count()).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => window.__attentionBoardSocket?.readyState)).toBe(1);

  const firstCard = board.locator('[data-testid^="session-attention-card-"]').first();
  const title = firstCard.locator('.line-clamp-2');
  const cardBox = await firstCard.boundingBox();
  const boardBox = await board.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(boardBox).not.toBeNull();
  expect(cardBox!.width).toBeGreaterThan(boardBox!.width - 50);
  expect(await title.textContent()).toBe(LONG_ATTENTION_TITLE);
  const longTitleBox = await title.boundingBox();
  expect(longTitleBox).not.toBeNull();
  expect(longTitleBox!.height).toBe(48);
  const shortTitle = board.locator('[data-testid^="session-attention-card-"]').filter({ hasText: 'alpha fixture session' }).first().locator('.line-clamp-2');
  const shortTitleBox = await shortTitle.boundingBox();
  expect(shortTitleBox).not.toBeNull();
  expect(shortTitleBox!.height).toBe(24);
  await expect(board.getByRole('button', { name: '全部处理完成' })).toBeVisible();
  await expect(firstCard.getByRole('checkbox', { name: '处理完成' })).toBeVisible();
  await expect(firstCard.getByRole('button', { name: '处理完成' })).toHaveCount(0);

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
  await page.screenshot({
    path: 'tests/debug/20260723-1445-session-attention-card-layout/screenshots/home-card-layout.png',
    fullPage: true,
  });

  const beforeHandledCount = await board.locator('[data-testid^="session-attention-card-"]').count();
  await firstCard.getByRole('checkbox', { name: '处理完成' }).check();
  await expect(board.locator('[data-testid^="session-attention-card-"]')).toHaveCount(beforeHandledCount - 1);
});
