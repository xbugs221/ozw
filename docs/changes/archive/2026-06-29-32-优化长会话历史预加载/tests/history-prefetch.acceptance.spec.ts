// @ts-nocheck -- 合同测试复用现有 e2e 夹具，执行阶段再随实现一起收紧类型。
/**
 * 文件目的：验证长会话向上翻阅时，前端会在到达顶部前主动预加载更早历史。
 */
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_PROJECT_PATHS,
  PLAYWRIGHT_FIXTURE_SESSION_IDS,
} from '../../../../tests/e2e/helpers/playwright-fixture.ts';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../../../backend/middleware/auth.ts'),
  import('../../../../backend/database/db.ts'),
]);

const HISTORY_SCROLL_PROJECT_INDEX = 5;
const HISTORY_SCROLL_SESSION_ID = PLAYWRIGHT_FIXTURE_SESSION_IDS[HISTORY_SCROLL_PROJECT_INDEX];
const HISTORY_SCROLL_PROJECT_PATH = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[HISTORY_SCROLL_PROJECT_INDEX];
const EVIDENCE_DIR = path.join(process.cwd(), 'test-results', '32-history-prefetch');
const TRACE_EVIDENCE_DIR = path.join(EVIDENCE_DIR, 'playwright');
const TRACE_EVIDENCE_PATH = path.join(TRACE_EVIDENCE_DIR, 'history-prefetch-trace.zip');

/**
 * 创建真实本地用户的浏览器认证 token。
 */
function createLocalAuthToken() {
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }

  return generateToken(user);
}

/**
 * 判断一次请求是否是会话消息读取接口。
 */
function isSessionMessagesUrl(rawUrl) {
  const url = new URL(rawUrl);
  return url.pathname.includes('/messages');
}

/**
 * 将 network 证据写入 test-results，便于执行阶段复核请求形态。
 */
function writeNetworkEvidence(messageRequests) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'network-prefetch.json'),
    JSON.stringify({ messageRequests }, null, 2),
    'utf8',
  );
}

/**
 * 解析真实项目的 cN 会话路由，避免依赖 legacy session 入口的恢复逻辑。
 */
async function resolveHistoryScrollRoute(page) {
  const authHeaders = { Authorization: `Bearer ${AUTH_TOKEN}` };
  const projectsResponse = await page.request.get('/api/projects', { headers: authHeaders });
  const projects = await projectsResponse.json();
  const project = projects.find((entry) => entry.fullPath === HISTORY_SCROLL_PROJECT_PATH);
  expect(project, `history-scroll project must be discoverable at ${HISTORY_SCROLL_PROJECT_PATH}`).toBeTruthy();

  const overviewResponse = await page.request.get(
    `/api/projects/${encodeURIComponent(project.name)}/overview?projectPath=${encodeURIComponent(HISTORY_SCROLL_PROJECT_PATH)}`,
    { headers: authHeaders },
  );
  const overview = await overviewResponse.json();
  const session = (overview.codexSessions || []).find((entry) =>
    entry.providerSessionId === HISTORY_SCROLL_SESSION_ID || entry.id === HISTORY_SCROLL_SESSION_ID,
  );
  expect(session?.routeIndex, 'history-scroll fixture session must have a cN route index').toBeTruthy();

  return `${project.routePath}/c${session.routeIndex}`;
}

const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
  }, AUTH_TOKEN);
});

test('长会话向上滚动到预加载区时，在到达顶部前请求更早历史', async ({ context, page }) => {
  fs.mkdirSync(TRACE_EVIDENCE_DIR, { recursive: true });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const messageRequests = [];
  try {
    await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
      messageRequests.push(route.request().url());
      await route.continue();
    });

    const sessionRoute = await resolveHistoryScrollRoute(page);
    await page.goto(sessionRoute, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

    const scrollContainer = page.getByTestId('chat-scroll-container');
    const olderPageRequest = page.waitForRequest((request) => {
      if (!isSessionMessagesUrl(request.url())) {
        return false;
      }
      const url = new URL(request.url());
      return url.searchParams.get('limit') === '100'
        && Number(url.searchParams.get('offset')) >= 100;
    }, { timeout: 5000 });

    const targetScrollTop = await scrollContainer.evaluate((element) => {
      /** 选择一个明显大于旧 100px 顶部阈值的位置，证明不是到顶才加载。 */
      const scrollableDistance = Math.max(0, element.scrollHeight - element.clientHeight);
      const preferredTop = Math.max(240, Math.floor(element.clientHeight * 0.75));
      return Math.min(preferredTop, Math.max(0, scrollableDistance - 8));
    });
    expect(targetScrollTop).toBeGreaterThan(100);

    await scrollContainer.evaluate((element, scrollTop) => {
      element.scrollTop = scrollTop;
      element.dispatchEvent(new Event('scroll'));
    }, targetScrollTop);

    await olderPageRequest;
    await expect
      .poll(async () => scrollContainer.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(100);

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'history-prefetch-anchor.png'),
      fullPage: false,
    });

    await scrollContainer.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 12');

    const unboundedRequests = messageRequests.filter((rawUrl) => {
      const url = new URL(rawUrl);
      return !url.searchParams.has('limit') && !url.searchParams.has('afterLine');
    });
    expect(unboundedRequests).toEqual([]);
    await expect
      .poll(async () => page.locator('.chat-message').count())
      .toBeLessThanOrEqual(150);

    writeNetworkEvidence(messageRequests);
  } finally {
    await context.tracing.stop({ path: TRACE_EVIDENCE_PATH });
  }
});
