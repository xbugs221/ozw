/**
 * 文件目的：验证首页待处理会话在实时失效刷新后保留用户的滚动位置。
 * 业务意义：后台会话持续产生活动时，用户仍能稳定浏览列表中部和底部。
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

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
]);

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

test('后台会话失效刷新不会让待处理列表回到顶部', async ({ page }) => {
  /**
   * 先滚动真实首页看板，再触发失效消息并等待真实刷新请求完成。
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
  await page.goto('/', { waitUntil: 'networkidle' });

  const board = page.getByTestId('session-attention-board');
  await expect(board).toBeVisible();
  await expect.poll(() => board.locator('[data-testid^="session-attention-card-"]').count()).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => window.__attentionBoardSocket?.readyState)).toBe(1);

  const beforeRefresh = await board.evaluate((element) => {
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    element.scrollTop = Math.min(320, maxScrollTop);
    element.dispatchEvent(new Event('scroll'));
    return { maxScrollTop, scrollTop: element.scrollTop };
  });
  expect(beforeRefresh.maxScrollTop).toBeGreaterThan(160);
  expect(beforeRefresh.scrollTop).toBeGreaterThan(100);

  const refreshResponse = page.waitForResponse((response) => (
    response.url().includes('/api/session-attention?limit=100')
    && response.request().method() === 'GET'
  ));
  await triggerSessionInvalidation(page);
  await refreshResponse;

  await expect.poll(() => board.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
});
