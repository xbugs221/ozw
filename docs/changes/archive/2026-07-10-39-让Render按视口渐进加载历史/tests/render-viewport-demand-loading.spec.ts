// @ts-nocheck -- 变更合同通过真实浏览器、JSONL 和网络记录表达执行阶段目标。
/**
 * 文件目的：验证 Render 按设备视口准备两页数据窗口，只在用户进入预留页时
 * 分页读取更早历史，并保持虚拟 DOM 与折叠重内容的延迟挂载边界。
 */
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_PROJECT_PATHS,
} from '../../../../tests/e2e/helpers/playwright-fixture.ts';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../../../backend/middleware/auth.ts'),
  import('../../../../backend/database/db.ts'),
]);

const LONG_SESSION_ID = 'fixture-mixed-long-virtual-session';
const FOLDED_BOOTSTRAP_SESSION_ID = 'fixture-folded-bootstrap-session';
const RESIZE_ORDER_SESSION_ID = 'fixture-history-scroll-session';
const FILTERED_WINDOW_SESSION_ID = 'fixture-filtered-window-session';
const FILTERED_TAIL_SESSION_ID = 'fixture-filtered-tail-session';
const LONG_PROJECT_PATH = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[5];
const LATEST_TEXT = 'mixed long virtual history turn 1050';
const FOLDED_BOOTSTRAP_LATEST_TEXT = 'folded bootstrap latest assistant message';
const RESIZE_ORDER_LATEST_TEXT = 'history scroll fixture session assistant turn 80';
const FILTERED_WINDOW_LATEST_TEXT = 'filtered window newest assistant 25';
const FILTERED_WINDOW_OLDER_TEXT = 'filtered window oldest assistant target';
const FILTERED_WINDOW_OLDER_KEY = `codex:${FILTERED_WINDOW_SESSION_ID}:line:3:msg:0`;
const FILTERED_TAIL_VISIBLE_TEXT = 'filtered tail visible assistant target';
const HIDDEN_TOOL_OUTPUT = 'mixed long virtual full tool output hidden line 140';
const ARTIFACT_DIR = path.join(process.cwd(), 'test-results', 'change-39-render-viewport-demand');
const MAX_RAW_BATCH_LIMIT = 50;
const MAX_DOM_ROWS = 150;
const FIRST_SCREEN_SCREENSHOTS = {
  desktop: 'desktop-first-screen.png',
  mobile: 'mobile-first-screen.png',
};

/**
 * 创建隔离测试用户的真实本地鉴权令牌。
 */
function createLocalAuthToken(): string {
  /** docstring：浏览器必须经过真实鉴权和后端路由，不能绕过应用入口。 */
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('Playwright fixture 中没有可用用户');
  }
  return generateToken(user);
}

const AUTH_TOKEN = createLocalAuthToken();

type MessageRequest = {
  url: string;
  limit: number | null;
  offset: number | null;
  afterLine: number | null;
  cursor: string | null;
  at: number;
};

/**
 * 从真实消息请求中读取数字查询参数。
 */
function readNumber(url: string, key: string): number | null {
  /** docstring：网络证据需要区分有界批次、旧历史 offset 和增量游标。 */
  const raw = new URL(url).searchParams.get(key);
  if (raw === null) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * 记录浏览器通过真实后端发出的所有会话消息请求。
 */
function recordMessageRequests(page): MessageRequest[] {
  /** docstring：只旁路观察网络，不拦截、不替换、不伪造响应。 */
  const requests: MessageRequest[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!new URL(url).pathname.includes('/messages')) {
      return;
    }
    requests.push({
      url,
      limit: readNumber(url, 'limit'),
      offset: readNumber(url, 'offset'),
      afterLine: readNumber(url, 'afterLine'),
      cursor: new URL(url).searchParams.get('cursor') || new URL(url).searchParams.get('afterCursor'),
      at: Date.now(),
    });
  });
  return requests;
}

/**
 * 保存可复核的本地验收状态，运行产物不进入版本控制。
 */
function writeEvidence(fileName: string, value: unknown): void {
  /** docstring：让评审者复核网络、滚动与 DOM 数量，而不依赖测试日志截断。 */
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * 从真实会话入口打开 Render，并等待最新消息成为可见组件。
 */
async function openRenderedLongSession(
  page,
  viewportName: string,
  sessionId = LONG_SESSION_ID,
  latestText = LATEST_TEXT,
) {
  /** docstring：默认先进入 TUI，再由用户动作点击顶部 Render Tab。 */
  await page.goto(`/session/${sessionId}?projectPath=${encodeURIComponent(LONG_PROJECT_PATH)}&viewport=${viewportName}`, {
    waitUntil: 'networkidle',
  });
  await expect(page.getByTestId('tab-chat')).toBeVisible();
  await page.getByTestId('tab-chat').click();
  const pane = page.getByTestId('chat-rendered-snapshot-pane');
  await expect(pane).toBeVisible();
  const scroll = pane.getByTestId('chat-scroll-container');
  await expect(scroll).toContainText(latestText);
  return { pane, scroll };
}

/**
 * 读取用户可感知的滚动容量和当前真实挂载节点数量。
 */
async function readRenderState(scroll) {
  /** docstring：以像素高度定义页面容量，以节点数量验证数据与 DOM 分离。 */
  return scroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    domRows: element.querySelectorAll('[data-virtual-row="chat-message"]').length,
    chatMessages: element.querySelectorAll('.chat-message').length,
    toolCards: element.querySelectorAll('[data-testid="codex-tool-card"]').length,
    lazyContent: element.querySelectorAll('[data-testid="collapsible-lazy-content"]').length,
  }));
}

/**
 * 找到当前视口顶部附近的稳定消息键和相对位置。
 */
async function readTopAnchor(scroll) {
  /** docstring：前插旧历史后应使用同一业务消息键恢复阅读位置。 */
  return scroll.evaluate((element) => {
    const containerRect = element.getBoundingClientRect();
    const messages = Array.from(element.querySelectorAll('.chat-message[data-message-key]'));
    const visible = messages
      .map((node) => ({
        key: node.getAttribute('data-message-key'),
        top: node.getBoundingClientRect().top - containerRect.top,
        bottom: node.getBoundingClientRect().bottom - containerRect.top,
      }))
      .filter((entry) => entry.bottom >= 0 && entry.top <= containerRect.height)
      .sort((left, right) => left.top - right.top);
    return visible[0] || null;
  });
}

test.beforeEach(async ({ page }) => {
  /** 每个用例都从真实登录态进入应用。 */
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
  }, AUTH_TOKEN);
});

test('桌面和手机首屏只准备当前页与一页预留', async ({ page }) => {
  /**
   * 失败含义：Render 仍使用固定 100 条窗口，或首屏稳定后继续扫描旧历史。
   */
  const requests = recordMessageRequests(page);
  const observations = [];
  const viewports = [
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'mobile', width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const requestStart = requests.length;
    const { scroll } = await openRenderedLongSession(page, viewport.name);
    const state = await readRenderState(scroll);
    const settledRequestCount = requests.length;
    await page.waitForTimeout(500);

    expect(state.clientHeight).toBeGreaterThan(0);
    expect(state.scrollHeight).toBeGreaterThanOrEqual(Math.floor(state.clientHeight * 1.75));
    expect(state.scrollHeight).toBeLessThanOrEqual(Math.ceil(state.clientHeight * 3.5));
    expect(state.domRows).toBeLessThanOrEqual(MAX_DOM_ROWS);
    expect(requests.length).toBe(settledRequestCount);

    const viewportRequests = requests.slice(requestStart);
    expect(viewportRequests.length).toBeGreaterThan(0);
    expect(viewportRequests.every((request) => (
      request.limit !== null && request.limit > 0 && request.limit <= MAX_RAW_BATCH_LIMIT
    ))).toBe(true);

    observations.push({ viewport, state, requests: viewportRequests });
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, FIRST_SCREEN_SCREENSHOTS[viewport.name]),
      fullPage: false,
    });
    await page.goto('about:blank');
  }

  const foldedRequestStart = requests.length;
  const { scroll: foldedScroll } = await openRenderedLongSession(
    page,
    'folded-bootstrap',
    FOLDED_BOOTSTRAP_SESSION_ID,
    FOLDED_BOOTSTRAP_LATEST_TEXT,
  );
  await expect.poll(() => requests.slice(foldedRequestStart).some((request) => (
    request.offset !== null && request.offset >= MAX_RAW_BATCH_LIMIT
  ))).toBe(true);
  await expect.poll(async () => {
    const state = await readRenderState(foldedScroll);
    return state.scrollHeight / state.clientHeight;
  }).toBeGreaterThanOrEqual(1.75);
  const foldedState = await readRenderState(foldedScroll);
  expect(foldedState.scrollHeight).toBeGreaterThanOrEqual(Math.floor(foldedState.clientHeight * 1.75));
  const foldedSettledCount = requests.length;
  await page.waitForTimeout(500);
  expect(requests.length).toBe(foldedSettledCount);
  observations.push({
    viewport: { name: 'folded-bootstrap', width: 1280, height: 720 },
    state: foldedState,
    requests: requests.slice(foldedRequestStart),
  });

  writeEvidence('initial-network.json', observations);
});

test('桌面和手机首屏只准备当前页与一页预留：同页放大保持消息顺序', async ({ page }) => {
  /** 失败含义：旧缓冲消息在视口放大时被错误追加到较新快照之后。 */
  await page.setViewportSize({ width: 1280, height: 300 });
  const requests = recordMessageRequests(page);
  const { pane, scroll } = await openRenderedLongSession(
    page,
    'resize-order',
    RESIZE_ORDER_SESSION_ID,
    RESIZE_ORDER_LATEST_TEXT,
  );
  await page.waitForTimeout(500);
  const settledCount = requests.length;

  await page.setViewportSize({ width: 1280, height: 500 });
  await expect.poll(async () => {
    const state = await readRenderState(scroll);
    return state.scrollHeight / state.clientHeight;
  }).toBeGreaterThanOrEqual(1.75);
  await page.waitForTimeout(500);
  expect(requests.slice(settledCount).every((request) => (
    request.limit !== null && request.limit <= MAX_RAW_BATCH_LIMIT
  ))).toBe(true);

  await expect(pane).toHaveAttribute('data-history-order', 'older-to-newer');
});

test('桌面和手机首屏只准备当前页与一页预留：瞬时失败按原游标重试', async ({ page }) => {
  /** 失败含义：一次传输失败被错误持久化成历史耗尽，用户无法重试。 */
  await page.setViewportSize({ width: 1280, height: 720 });
  const requests = recordMessageRequests(page);
  let failedOnce = false;
  await page.route(/\/messages(?:\?|$)/, async (route) => {
    const requestUrl = route.request().url();
    if (
      requestUrl.includes(FOLDED_BOOTSTRAP_SESSION_ID)
      && readNumber(requestUrl, 'offset') === MAX_RAW_BATCH_LIMIT
      && !failedOnce
    ) {
      failedOnce = true;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  const { pane, scroll } = await openRenderedLongSession(
    page,
    'retry-offset',
    FOLDED_BOOTSTRAP_SESSION_ID,
    FOLDED_BOOTSTRAP_LATEST_TEXT,
  );
  await expect.poll(() => failedOnce).toBe(true);
  await expect(pane).toHaveAttribute('data-has-more-history', 'true');
  const before = await readTopAnchor(scroll);
  const failedOffsetCount = requests.filter((request) => request.offset === MAX_RAW_BATCH_LIMIT).length;
  expect(failedOffsetCount).toBe(1);
  await page.waitForTimeout(300);
  const stableAfterFailure = await readTopAnchor(scroll);
  expect(stableAfterFailure?.key).toBe(before?.key);
  expect(Math.abs(stableAfterFailure.top - before.top)).toBeLessThanOrEqual(1);

  await scroll.evaluate((element) => { element.scrollTop = 0; });
  await scroll.dispatchEvent('wheel', { deltaY: -10 });
  await expect.poll(() => requests.filter((request) => (
    request.offset === MAX_RAW_BATCH_LIMIT
  )).length).toBeGreaterThan(failedOffsetCount);
  await expect.poll(async () => {
    const state = await readRenderState(scroll);
    return state.scrollHeight / state.clientHeight;
  }).toBeGreaterThanOrEqual(1.75);

  expect(before?.key).toBeTruthy();
  await expect(scroll).toContainText(FOLDED_BOOTSTRAP_LATEST_TEXT);
  await expect(pane).toHaveAttribute('data-has-more-history', 'true');
  const settledCount = requests.length;
  await page.waitForTimeout(500);
  expect(requests.length).toBe(settledCount);
});

test('桌面和手机首屏只准备当前页与一页预留：首个空展示页继续准备', async ({ page }) => {
  /** 失败含义：offset 0 为空时首屏准备结束且 Render 永久空白。 */
  await page.setViewportSize({ width: 1280, height: 720 });
  const requests = recordMessageRequests(page);
  const { pane, scroll } = await openRenderedLongSession(
    page,
    'filtered-tail',
    FILTERED_TAIL_SESSION_ID,
    FILTERED_TAIL_VISIBLE_TEXT,
  );

  await expect.poll(() => requests.some((request) => request.offset === 50)).toBe(true);
  await expect(scroll).toContainText(FILTERED_TAIL_VISIBLE_TEXT);
  await expect(pane).toHaveAttribute('data-next-history-offset', '53');
  await expect(pane).toHaveAttribute('data-has-more-history', 'false');
  const settledCount = requests.length;
  await page.waitForTimeout(500);
  expect(requests.length).toBe(settledCount);
});

test('进入预留页才读取更早历史并保持锚点', async ({ page }) => {
  /**
   * 失败含义：Render 滚动仍未接入分页，或前插历史导致当前阅读位置跳动。
   */
  await page.setViewportSize({ width: 1280, height: 720 });
  const requests = recordMessageRequests(page);
  const { pane, scroll } = await openRenderedLongSession(page, 'paging');
  const settledCount = requests.length;
  await page.waitForTimeout(400);
  expect(requests.length).toBe(settledCount);
  await expect(pane).toHaveAttribute('data-has-more-history', 'true');

  const olderRequest = page.waitForRequest((request) => {
    const url = request.url();
    const parsed = new URL(url);
    return parsed.pathname.includes('/messages')
      && ((readNumber(url, 'offset') || 0) > 0
        || Boolean(parsed.searchParams.get('cursor') || parsed.searchParams.get('afterCursor')));
  }, { timeout: 5000 });

  const before = await scroll.evaluate((element) => {
    const target = Math.max(1, Math.min(element.clientHeight * 0.75, element.scrollHeight - element.clientHeight - 1));
    element.scrollTop = target + Math.min(5, Math.max(0, element.scrollHeight - element.clientHeight - target));
    const containerRect = element.getBoundingClientRect();
    const messages = Array.from(element.querySelectorAll('.chat-message[data-message-key]'));
    const anchor = messages
      .map((node) => ({
        key: node.getAttribute('data-message-key'),
        top: node.getBoundingClientRect().top - containerRect.top,
        bottom: node.getBoundingClientRect().bottom - containerRect.top,
      }))
      .filter((entry) => entry.bottom >= 0 && entry.top <= containerRect.height)
      .sort((left, right) => left.top - right.top)[0] || null;
    return {
      anchor,
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  });
  await scroll.dispatchEvent('wheel', { deltaY: -10 });

  await olderRequest;
  await expect.poll(() => requests.length).toBeGreaterThan(settledCount);
  await page.waitForTimeout(500);
  const quietCount = requests.length;
  await page.waitForTimeout(500);
  expect(requests.length).toBe(quietCount);

  const after = {
    anchor: await readTopAnchor(scroll),
    ...(await readRenderState(scroll)),
  };
  expect(before.anchor?.key).toBeTruthy();
  expect(after.anchor?.key).toBe(before.anchor.key);
  expect(Math.abs(after.anchor.top - before.anchor.top)).toBeLessThanOrEqual(80);
  expect(requests.every((request) => request.limit !== null && request.limit <= MAX_RAW_BATCH_LIMIT)).toBe(true);

  const secondOlderRequest = page.waitForRequest((request) => {
    const url = request.url();
    return new URL(url).pathname.includes('/messages')
      && (readNumber(url, 'offset') || 0) >= MAX_RAW_BATCH_LIMIT * 2;
  }, { timeout: 5000 });
  const secondBefore = await scroll.evaluate((element) => {
    element.scrollTop = Math.max(1, Math.min(
      element.clientHeight * 0.75 + 5,
      element.scrollHeight - element.clientHeight - 1,
    ));
    const containerRect = element.getBoundingClientRect();
    const anchor = Array.from(element.querySelectorAll('.chat-message[data-message-key]'))
      .map((node) => ({
        key: node.getAttribute('data-message-key'),
        top: node.getBoundingClientRect().top - containerRect.top,
        bottom: node.getBoundingClientRect().bottom - containerRect.top,
      }))
      .filter((entry) => entry.bottom >= 0 && entry.top <= containerRect.height)
      .sort((left, right) => left.top - right.top)[0] || null;
    return anchor;
  });
  await scroll.dispatchEvent('wheel', { deltaY: -10 });
  await secondOlderRequest;
  await page.waitForTimeout(500);
  const secondAfter = await readTopAnchor(scroll);
  expect(secondBefore?.key).toBeTruthy();
  expect(secondAfter?.key).toBe(secondBefore.key);
  expect(Math.abs(secondAfter.top - secondBefore.top)).toBeLessThanOrEqual(80);
  const secondQuietCount = requests.length;
  await page.waitForTimeout(500);
  expect(requests.length).toBe(secondQuietCount);

  writeEvidence('paging-network.json', requests);
  writeEvidence('paging-state.json', {
    before,
    after,
    secondBefore,
    secondAfter,
    settledCount,
    quietCount,
    secondQuietCount,
  });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'anchor-after-prepend.png'), fullPage: false });
});

test('进入预留页才读取更早历史并保持锚点：跨越空展示原始页', async ({ page }) => {
  /** 失败含义：原始游标前进但页面无展示消息时，被错误持久化成历史耗尽。 */
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const requests = recordMessageRequests(page);
  const { pane, scroll } = await openRenderedLongSession(
    page,
    'filtered-window-scroll',
    FILTERED_WINDOW_SESSION_ID,
    FILTERED_WINDOW_LATEST_TEXT,
  );
  await page.waitForTimeout(400);

  for (let attempt = 0; attempt < 4 && !requests.some((request) => request.offset === 100); attempt += 1) {
    await scroll.evaluate((element) => { element.scrollTop = 0; });
    await scroll.dispatchEvent('wheel', { deltaY: -10 });
    await page.waitForTimeout(600);
  }

  await expect.poll(() => requests.some((request) => request.offset === 50)).toBe(true);
  await expect.poll(() => requests.some((request) => request.offset === 100)).toBe(true);
  await expect(pane).toHaveAttribute('data-history-order', 'older-to-newer');
  await scroll.evaluate((element) => { element.scrollTop = 0; });
  await expect(scroll).toContainText(FILTERED_WINDOW_OLDER_TEXT);

  await page.goto('about:blank');
  const searchRequestStart = requests.length;
  await page.goto('/workspace/history-scroll/c3?viewport=filtered-window-search', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tab-chat')).toBeVisible();
  await page.getByTestId('tab-chat').click();
  const searchPane = page.getByTestId('chat-rendered-snapshot-pane');
  await expect(searchPane).toBeVisible();
  await expect(searchPane.getByTestId('chat-scroll-container')).toContainText(FILTERED_WINDOW_LATEST_TEXT);
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
          sessionId: FILTERED_WINDOW_SESSION_ID,
          sessionSummary: 'Filtered Window Session',
          messageKey: FILTERED_WINDOW_OLDER_KEY,
          snippet: FILTERED_WINDOW_OLDER_TEXT,
          timestamp: '2026-04-15T08:00:02.000Z',
        }],
      }),
    });
  });
  await page.evaluate(() => window.openChatHistorySearch?.());
  const searchInput = page.getByTestId('chat-history-search-input');
  await expect(searchInput).toBeVisible();
  await searchInput.fill(FILTERED_WINDOW_OLDER_TEXT);
  await searchInput.press('Enter');
  const result = page.getByTestId('chat-history-search-result').first();
  await expect(result).toContainText(FILTERED_WINDOW_OLDER_TEXT);
  await result.click();

  await expect.poll(() => requests.slice(searchRequestStart).some((request) => request.offset === 50)).toBe(true);
  await expect.poll(() => requests.slice(searchRequestStart).some((request) => request.offset === 100)).toBe(true);
  const target = page.locator(`.chat-message[data-message-key="${FILTERED_WINDOW_OLDER_KEY}"]`);
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
});

test('进入预留页才读取更早历史并保持锚点：普通搜索跨越空展示原始页', async ({ page }) => {
  /** 失败含义：非 Render 的目标搜索仍在 offset 50 空展示页标记全部加载。 */
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const requests = recordMessageRequests(page);
  await page.goto('/workspace/history-scroll/c3?viewport=ordinary-filtered-search', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tab-chat')).toBeVisible();
  const requestStart = requests.length;
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
          sessionId: FILTERED_WINDOW_SESSION_ID,
          sessionSummary: 'Filtered Window Session',
          messageKey: FILTERED_WINDOW_OLDER_KEY,
          snippet: FILTERED_WINDOW_OLDER_TEXT,
          timestamp: '2026-04-15T08:00:02.000Z',
        }],
      }),
    });
  });
  await page.evaluate(() => window.openChatHistorySearch?.());
  const searchInput = page.getByTestId('chat-history-search-input');
  await searchInput.fill(FILTERED_WINDOW_OLDER_TEXT);
  await searchInput.press('Enter');
  const result = page.getByTestId('chat-history-search-result').first();
  await expect(result).toContainText(FILTERED_WINDOW_OLDER_TEXT);
  await result.click();

  await expect.poll(() => requests.slice(requestStart).some((request) => request.offset === 50)).toBe(true);
  await expect.poll(() => requests.slice(requestStart).some((request) => request.offset === 100)).toBe(true);
});

test('进入预留页才读取更早历史并保持锚点：搜索持续失败停止自动重试', async ({ page }) => {
  /** 失败含义：URL 搜索目标缺失时，每次 500 都自动触发下一次请求。 */
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const requests = recordMessageRequests(page);
  await page.route(/\/messages(?:\?|$)/, async (route) => {
    const offset = readNumber(route.request().url(), 'offset') || 0;
    if (offset > 0) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'persistent failure' }) });
      return;
    }
    await route.continue();
  });

  await page.goto('/workspace/history-scroll/c3?viewport=persistent-search-failure', { waitUntil: 'networkidle' });
  await page.getByTestId('tab-chat').click();
  const pane = page.getByTestId('chat-rendered-snapshot-pane');
  await expect(pane).toBeVisible();
  await expect(pane.getByTestId('chat-scroll-container')).toContainText(FILTERED_WINDOW_LATEST_TEXT);
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
          sessionId: FILTERED_WINDOW_SESSION_ID,
          sessionSummary: 'Filtered Window Session',
          messageKey: FILTERED_WINDOW_OLDER_KEY,
          snippet: FILTERED_WINDOW_OLDER_TEXT,
          timestamp: '2026-04-15T08:00:02.000Z',
        }],
      }),
    });
  });
  await page.evaluate(() => window.openChatHistorySearch?.());
  const searchInput = page.getByTestId('chat-history-search-input');
  await searchInput.fill(FILTERED_WINDOW_OLDER_TEXT);
  await searchInput.press('Enter');
  const result = page.getByTestId('chat-history-search-result').first();
  await expect(result).toContainText(FILTERED_WINDOW_OLDER_TEXT);
  await result.click();

  await expect.poll(() => requests.filter((request) => (request.offset || 0) > 0).length).toBeGreaterThan(0);
  const failedRequestCount = requests.filter((request) => (request.offset || 0) > 0).length;
  await page.waitForTimeout(1200);
  expect(requests.filter((request) => (request.offset || 0) > 0).length).toBe(failedRequestCount);
  await expect(pane.getByTestId('chat-scroll-container')).toContainText(FILTERED_WINDOW_LATEST_TEXT);
});

test('离屏与折叠重内容只在需要时挂载', async ({ page }) => {
  /**
   * 失败含义：分页后的离屏消息扩大 DOM，或关闭的折叠分支已经创建重内容。
   */
  await page.setViewportSize({ width: 1280, height: 720 });
  const { pane, scroll } = await openRenderedLongSession(page, 'lazy');
  const before = await readRenderState(scroll);
  expect(before.domRows).toBeLessThanOrEqual(MAX_DOM_ROWS);
  expect(before.toolCards).toBe(0);
  expect(before.lazyContent).toBe(0);
  await expect(page.getByText(HIDDEN_TOOL_OUTPUT)).toHaveCount(0);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'lazy-before-expand.png'), fullPage: false });

  const toggles = pane.getByTestId('turn-tool-list-toggle');
  const toggleCount = await toggles.count();
  expect(toggleCount).toBeGreaterThan(0);
  for (let index = 0; index < toggleCount; index += 1) {
    await toggles.nth(index).click();
  }

  const outputCard = pane.getByTestId('codex-tool-card').filter({ hasText: 'write_stdin' });
  await expect(outputCard).toBeVisible();
  await expect(page.getByText(HIDDEN_TOOL_OUTPUT)).toHaveCount(0);
  await expect(pane.getByTestId('collapsible-lazy-content')).toHaveCount(0);

  await outputCard.locator('summary').filter({ hasText: 'Output' }).click();
  await expect(outputCard.getByTestId('large-tool-output-summary')).toBeVisible();
  await expect(pane.getByTestId('collapsible-lazy-content')).toHaveCount(1);
  await expect(page.getByText(HIDDEN_TOOL_OUTPUT)).toHaveCount(0);
  await outputCard.getByRole('button', { name: /Show .* more lines/ }).click();
  await expect(page.getByText(HIDDEN_TOOL_OUTPUT)).toBeVisible();

  const after = await readRenderState(scroll);
  expect(after.domRows).toBeLessThanOrEqual(MAX_DOM_ROWS);
  writeEvidence('dom-state.json', { before, after });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'lazy-after-expand.png'), fullPage: false });
});
