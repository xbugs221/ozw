// @ts-nocheck -- Spec browser test uses browser-injected lifecycle and WebSocket helpers.
/**
 * Sources: 2026-06-05-75-修复前端请求取消噪声和Codex原始消息渲染
 *
 * 文件目的：验证前端请求取消噪声和 Codex 协议 JSON 渲染的真实业务合同。
 *
 * 业务场景：页面刷新、路由切换或组件卸载取消 slash commands 请求时，QA 不应看到
 * `Error fetching slash commands` 这类伪错误。
 * 业务场景：Codex WebSocket 偶发推送 add/update 文件变更 JSON 字符串时，聊天正文不得显示 raw JSON 或写入内容。
 * 失败含义：失败代表浏览器证据仍被正常取消噪声污染，或 Codex 用户仍会看到不可理解的协议 JSON。
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
import { installProviderRuntimeHarness } from './helpers/provider-runtime-harness.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/frontend-runtime-noise-and-codex-render');
const SESSION_DAY = ['2026', '06', '05'];
const JSON_RESPONSE_TITLE = /JSON (Response|响应)|JSON 响应/;

/**
 * Resolve the fixture Codex JSONL path for the acceptance session.
 */
function codexSessionPath(sessionId: string): string {
  /** docstring：让真实应用从隔离 HOME 中读取 Codex 历史，而不是伪造页面状态。 */
  return path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', ...SESSION_DAY, `${sessionId}.jsonl`);
}

/**
 * Write a minimal Codex session that the real app can route to.
 */
async function writeCodexSession(sessionId: string): Promise<void> {
  /** docstring：构造真实 JSONL 输入，使验收覆盖 session route 和消息渲染链路。 */
  const sessionPath = codexSessionPath(sessionId);
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  const entries = [
    {
      type: 'session_meta',
      timestamp: '2026-06-05T08:00:00.000Z',
      payload: {
        id: sessionId,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        model: 'gpt-5-codex',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-05T08:00:01.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '75 提案 Codex 真实正文必须保留。' }],
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-05T08:00:02.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            type: 'report',
            path: 'roadmap.json',
            content: '业务 JSON 输出必须保留',
          }),
        }],
      },
    },
  ];

  await fs.writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

/**
 * Write a Codex session with enough messages to require paged history loading.
 */
async function writeLongCodexRenderSession(sessionId: string, messageCount: number): Promise<void> {
  /** docstring：用真实 JSONL 长历史验证“渲染”快照读取完整会话，而不是只读第一页。 */
  const sessionPath = codexSessionPath(sessionId);
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });

  const entries = [
    {
      type: 'session_meta',
      timestamp: '2026-06-05T09:00:00.000Z',
      payload: {
        id: sessionId,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        model: 'gpt-5-codex',
      },
    },
  ];

  for (let index = 1; index <= messageCount; index += 1) {
    const marker = String(index).padStart(3, '0');
    entries.push({
      type: 'response_item',
      timestamp: new Date(Date.UTC(2026, 5, 5, 9, index, 0)).toISOString(),
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: `Codex full render snapshot turn ${marker}` }],
      },
    });
  }

  await fs.writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

/**
 * Install a fake WebSocket that lets the test emit backend messages through the
 * same browser event surface used by the production chat UI.
 */
async function installCodexRuntimeSocket(page): Promise<void> {
  /** docstring：只替换 WebSocket 传输层，保留真实 React 页面和消息 reducer 渲染。 */
  await installProviderRuntimeHarness(page, {
    sentKey: '__proposal75SharedSentMessages',
    eventsKey: '__proposal75SharedEvents',
    socketKey: '__proposal75SharedSocket',
    emitKey: '__proposal75SharedEmit',
  });
  await page.addInitScript(() => {
    window.__proposal75SentMessages = window.__proposal75SharedSentMessages || [];
    window.__proposal75EmitWs = (message) => {
      const sessionId = window.location.pathname.split('/').filter(Boolean).pop();
      window.__proposal75SharedEmit?.({ sessionId, provider: 'codex', ...message });
    };
  });
}

/**
 * Persist browser QA evidence for review and future oz flow runs.
 */
async function writeBrowserEvidence(name: string, evidence: Record<string, unknown>): Promise<void> {
  /** docstring：把 console/network 分类写入磁盘，避免只依赖 Playwright 失败文本。 */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, name),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), ...evidence }, null, 2)}\n`,
    'utf8',
  );
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('slash commands 正常请求取消不写 console error，并被 QA 证据归类为 expected cancellation', async ({ page }) => {
  /**
   * 业务场景：用真实项目页面加载 chat 输入区，再让 slash commands 请求以 AbortError 结束。
   * 失败含义：如果这里失败，页面生命周期取消仍会污染 QA console 证据。
   */
  const consoleErrors: Array<{ text: string; location: unknown }> = [];
  const pageErrors: string[] = [];
  const requestFailures: Array<{ url: string; failureText: string; classification: string }> = [];

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__proposal75AbortCount = 0;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (String(url).includes('/api/commands/list')) {
        window.__proposal75AbortCount += 1;
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new TypeError('Failed to fetch'));
          }, { once: true });
        });
      }
      return originalFetch(input, init);
    };
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({ text: message.text(), location: message.location() });
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText || '';
    requestFailures.push({
      url: request.url(),
      failureText,
      classification: /net::ERR_ABORTED|abort|cancel/i.test(failureText) ? 'expected-cancellation' : 'unhandled',
    });
  });

  await openFixtureProject(page);
  await expect.poll(() => page.evaluate(() => window.__proposal75AbortCount || 0)).toBeGreaterThan(0);
  const expectedCancellations = await page.evaluate(() => window.__proposal75AbortCount || 0);
  await page.goto('/login');
  await page.waitForTimeout(50);

  const slashCommandErrors = consoleErrors.filter((entry) => entry.text.includes('Error fetching slash commands'));
  const unhandledRequestFailures = requestFailures.filter((entry) => entry.classification === 'unhandled');
  const evidence = {
    consoleErrors,
    pageErrors,
    requestFailures,
    unhandledRequestFailures,
    slashCommandErrors,
    expectedCancellations,
  };
  await writeBrowserEvidence('slash-command-cancellation-evidence.json', evidence);
  await writeBrowserEvidence('browser-evidence.json', evidence);

  expect(pageErrors).toEqual([]);
  expect(unhandledRequestFailures, '未分类 requestfailed 必须作为真实网络失败拦截').toEqual([]);
  expect(slashCommandErrors, '正常取消不得写 Error fetching slash commands console error').toEqual([]);
});

test('slash commands 非取消失败仍保留 console error 诊断', async ({ page }) => {
  /**
   * 业务场景：服务端真实失败不能被取消静音规则吞掉。
   * 失败含义：如果这里失败，修复把真实故障误归类成 expected cancellation。
   */
  const consoleErrors: string[] = [];

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (String(url).includes('/api/commands/list')) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return originalFetch(input, init);
    };
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await openFixtureProject(page);
  await expect.poll(() => consoleErrors.some((text) => text.includes('Error fetching slash commands'))).toBe(true);
});

test('Codex WS add/update 文件变更 JSON 字符串不会作为 assistant raw JSON 正文渲染', async ({ page }) => {
  /**
   * 业务场景：Codex app-server 偶发把新建/更新文件并写入内容的 add/update payload 包在 agent_message content 字符串里。
   * 失败含义：如果这里失败，用户会在聊天区看到 raw JSON，而不是结构化文件变更或正常对话内容。
   */
  const sessionId = 'proposal-75-codex-raw-json-ws';
  await writeCodexSession(sessionId);
  await installCodexRuntimeSocket(page);

  const params = new URLSearchParams({
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
  });
  await page.goto(`/session/${sessionId}?${params.toString()}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="chat-scroll-container"]').last()).toContainText('75 提案 Codex 真实正文必须保留。');
  await expect(page.locator('[data-testid="chat-scroll-container"]').last()).toContainText(JSON_RESPONSE_TITLE);
  await expect(page.locator('[data-testid="chat-scroll-container"]').last()).toContainText('业务 JSON 输出必须保留');

  await page.evaluate(() => {
    const fileOperations = [
      {
        itemId: 'proposal-75-file-add-json',
        type: 'add',
        path: 'frontend/proposal75-created-file.ts',
        content: 'export const proposal75CreatedFile = true;\\n',
        summary: '新建文件并写入内容',
      },
      {
        itemId: 'proposal-75-file-update-json',
        type: 'update',
        path: 'frontend/proposal75-updated-file.ts',
        content: 'export const proposal75UpdatedFile = true;\\n',
        summary: '更新文件并写入内容',
      },
    ];
    for (const operation of fileOperations) {
      window.__proposal75EmitWs?.({
        type: 'codex-response',
        provider: 'codex',
        data: {
          type: 'item',
          itemType: 'agent_message',
          itemId: operation.itemId,
          message: {
            role: 'assistant',
            content: JSON.stringify(operation),
          },
        },
      });
    }
  });

  const chat = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(chat).toContainText('75 提案 Codex 真实正文必须保留。');
  await expect(chat).toContainText(JSON_RESPONSE_TITLE);
  await expect(chat).toContainText('业务 JSON 输出必须保留');
  await expect(page.getByTestId('codex-tool-card').filter({ hasText: 'frontend/proposal75-created-file.ts' }).first()).toBeVisible();
  await expect(page.getByTestId('codex-tool-card').filter({ hasText: 'frontend/proposal75-updated-file.ts' }).first()).toBeVisible();
  await expect(chat).not.toContainText('"type": "add"');
  await expect(chat).not.toContainText('proposal75CreatedFile');
  await expect(chat).not.toContainText('proposal75UpdatedFile');

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'codex-after-ws-json.png'), fullPage: true });
});

test('Codex 渲染快照按视口展示尾页且不自动扫描完整历史', async ({ page }) => {
  /**
   * 业务场景：用户点击顶部消息 Tab 后先看到最新页，旧历史只随上翻读取。
   * 失败含义：Render 又在首屏后台扫描完整历史，或丢失最新消息。
   */
  const sessionId = 'proposal-75-codex-full-render-snapshot';
  await writeLongCodexRenderSession(sessionId, 130);

  const params = new URLSearchParams({
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
  });
  await page.goto(`/session/${sessionId}?${params.toString()}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tab-chat')).toBeVisible();
  const messageRequests: string[] = [];
  page.on('request', (request) => {
    /** Record real message requests without replacing backend responses. */
    if (new URL(request.url()).pathname.includes('/messages')) messageRequests.push(request.url());
  });

  await page.getByTestId('tab-chat').click();

  const snapshotPane = page.getByTestId('chat-rendered-snapshot-pane');
  const chat = page.getByTestId('chat-scroll-container').last();
  await expect(snapshotPane).toBeVisible();
  await expect(page.getByTestId('chat-return-tui-button')).toHaveCount(0);
  await expect(page.getByTestId('chat-rerender-snapshot-button')).toHaveCount(0);
  await expect(chat).toContainText('Codex full render snapshot turn 130');
  await expect(chat).not.toContainText('Codex full render snapshot turn 001');
  const settledRequestCount = messageRequests.length;
  await page.waitForTimeout(500);
  expect(messageRequests.length).toBe(settledRequestCount);
  expect(messageRequests.every((url) => Number(new URL(url).searchParams.get('limit')) <= 50)).toBe(true);
  await expect.poll(async () => chat.evaluate((element) => (
    element.scrollHeight - element.scrollTop - element.clientHeight
  ))).toBeLessThan(8);

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'codex-full-render-snapshot.png'), fullPage: true });
});
