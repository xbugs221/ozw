// @ts-nocheck -- Proposal acceptance tests focus on browser-visible business behavior.
/**
 * PURPOSE: 用真实浏览器验收 Codex 手动会话第二轮发送后的实时消息链路。
 * 本文件覆盖两个历史 bug：live 推送期间旧响应正文消失，以及完成重载后用户消息错位到本轮响应下面。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  ensurePlaywrightFixture,
  PLAYWRIGHT_FIXTURE_HOME,
} from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  getFixtureProject,
} from './helpers/spec-test-helpers.ts';

const SESSION_DAY = ['2026', '06', '06'];
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/proposal-79-codex-live-followup');

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

/**
 * Resolve the JSONL file path used by the real Codex session reader.
 */
function codexSessionPath(sessionId: string): string {
  /**
   * docstring：测试写入 Playwright 隔离 HOME，而不是开发者真实 HOME，
   * 这样端到端运行不会污染本机 Codex 历史。
   */
  return path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', ...SESSION_DAY, `${sessionId}.jsonl`);
}

/**
 * Write a complete Codex JSONL file for one fixture session.
 */
async function writeCodexSession(sessionId: string, entries: Array<Record<string, unknown>>): Promise<void> {
  /**
   * docstring：真实后端会从这个 JSONL 文件解析 session meta、用户消息和 assistant 响应，
   * 测试不绕过 session messages HTTP 入口。
   */
  const sessionPath = codexSessionPath(sessionId);
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

/**
 * Append new Codex JSONL rows to simulate provider persistence before completion.
 */
async function appendCodexEntries(sessionId: string, entries: Array<Record<string, unknown>>): Promise<void> {
  /**
   * docstring：第二轮完成场景必须让前端重新读取真实落盘历史，
   * 不能只靠本地 optimistic message 判断顺序。
   */
  await fs.appendFile(codexSessionPath(sessionId), `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

/**
 * Build a Codex session metadata row tied to the fixture project.
 */
function sessionMeta(sessionId: string, timestamp = '2026-06-06T01:00:00.000Z'): Record<string, unknown> {
  /**
   * docstring：session meta 中的 cwd 决定该 JSONL 会话归属于哪个项目。
   */
  return {
    type: 'session_meta',
    timestamp,
    payload: {
      id: sessionId,
      cwd: PRIMARY_FIXTURE_PROJECT_PATH,
      model: 'gpt-5-codex',
    },
  };
}

/**
 * Build a visible user turn in the Codex JSONL shape used by project discovery.
 */
function userEvent(timestamp: string, text: string): Record<string, unknown> {
  /**
   * docstring：event_msg/user_message 是真实 Codex JSONL 中最常见的用户输入记录，
   * 项目首页标题和聊天 transcript 都会读取它。
   */
  return {
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'user_message',
      message: text,
    },
  };
}

/**
 * Build a visible assistant message in Codex response_item format.
 */
function assistantMessage(timestamp: string, text: string): Record<string, unknown> {
  /**
   * docstring：assistant 文本使用 output_text part，覆盖真实 Codex JSONL 回放路径。
   */
  return {
    type: 'response_item',
    timestamp,
    payload: {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: [{ type: 'output_text', text }],
    },
  };
}

/**
 * Build a non-visible lifecycle event row that makes the transcript look like a completed turn.
 */
function eventMsg(timestamp: string, type: string): Record<string, unknown> {
  /**
   * docstring：完成事件本身不应渲染为聊天气泡，但会出现在真实 JSONL 中。
   */
  return {
    type: 'event_msg',
    timestamp,
    payload: { type },
  };
}

/**
 * Install a browser WebSocket harness that records real composer sends and injects Codex events.
 */
async function installCodexSocketHarness(page): Promise<void> {
  /**
   * docstring：测试只替换实时传输层，页面、composer、HTTP API、JSONL 读取和 DOM 渲染仍然走真实应用代码。
   */
  await page.addInitScript(() => {
    window.__capturedWsMessages = [];
    window.__ozwLiveSockets = [];
    window.localStorage.setItem('selected-provider', 'codex');

    class FakeWebSocket extends EventTarget {
      constructor(url) {
        super();
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        window.__ozwLiveSockets.push(this);
        window.__ozwActiveLiveSocket = this;
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          window.__ozwLiveSocketOpened = true;
          const event = new Event('open');
          this.onopen?.(event);
          this.dispatchEvent(event);
        }, 0);
      }

      send(payload) {
        try {
          window.__capturedWsMessages.push(JSON.parse(payload));
        } catch {
          window.__capturedWsMessages.push(payload);
        }
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        const event = new Event('close');
        this.onclose?.(event);
        this.dispatchEvent(event);
      }
    }

    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;

    window.WebSocket = FakeWebSocket;
    window.__emitCbwSocketMessage = (message) => {
      const socket = window.__ozwActiveLiveSocket;
      if (!socket) {
        throw new Error('No active fake WebSocket is available');
      }
      const event = new MessageEvent('message', { data: JSON.stringify(message) });
      socket.onmessage?.(event);
      socket.dispatchEvent(event);
    };
  });
}

/**
 * Record console, page error, and failed request noise for strict E2E evidence.
 */
function attachNoiseRecorder(page) {
  /**
   * docstring：业务断言通过但浏览器报错时，验收仍然不可信，所以这里把噪声记录下来并最终断言为空。
   */
  const recorder = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    ignoredRequestAborts: [] as string[],
    failedRequests: [] as string[],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      recorder.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    recorder.pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown failure';
    if (failure === 'net::ERR_ABORTED') {
      recorder.ignoredRequestAborts.push(`${request.method()} ${request.url()} ${failure}`);
      return;
    }
    recorder.failedRequests.push(`${request.method()} ${request.url()} ${failure}`);
  });

  return recorder;
}

/**
 * Build the fallback project route prefix if the API payload lacks routePath.
 */
function buildExpectedProjectRoutePrefix(): string {
  /**
   * docstring：正常情况下使用后端返回的 routePath；这里保留兜底逻辑，
   * 防止 routePath 字段缺失时测试无法定位 cN 路由。
   */
  const homePath = process.env.HOME || process.env.USERPROFILE || '';
  const relativePath = path.relative(homePath, PRIMARY_FIXTURE_PROJECT_PATH).split(path.sep).join('/');
  return `/${relativePath}`;
}

/**
 * Wait until the project API exposes the newly written Codex fixture session.
 */
async function getFixtureProjectWithCodexSession(request, sessionId: string) {
  /**
   * docstring：Codex session discovery is asynchronous, so route lookup must wait
   * for the real project API to publish the JSONL file written by this test.
   */
  let latestProject = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latestProject = await getFixtureProject(request);
    const codexSessions = Array.isArray(latestProject.codexSessions) ? latestProject.codexSessions : [];
    const session = codexSessions.find((candidate) => candidate.id === sessionId);
    if (session) {
      return { project: latestProject, session };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Could not find Codex fixture session ${sessionId} in project API payload`);
}

/**
 * Open the real project page, find the generated cN route, and navigate to it.
 */
async function openManualCodexRoute(page, request, sessionId: string) {
  /**
   * docstring：用户真实操作是打开项目里的手动会话，因此测试不用裸 UUID 路由，
   * 而是通过项目索引拿到当前会话的 cN routeIndex。
   */
  const { project, session } = await getFixtureProjectWithCodexSession(request, sessionId);
  if (!Number.isInteger(Number(session.routeIndex))) {
    throw new Error(`Codex fixture session ${sessionId} has no cN routeIndex`);
  }

  const routeSessionId = `c${Number(session.routeIndex)}`;
  const projectRoutePrefix = project.routePath || buildExpectedProjectRoutePrefix();
  await page.goto(`${projectRoutePrefix}/${routeSessionId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  await expect(page.locator('textarea').first()).toBeVisible();

  return {
    routeSessionId,
    routePath: `${projectRoutePrefix}/${routeSessionId}`,
    providerSessionId: sessionId,
  };
}

/**
 * Submit a user message through the real chat composer.
 */
async function submitUserMessage(page, text: string): Promise<void> {
  /**
   * docstring：这里不用直接调用 React state 或 WebSocket send，
   * 必须像用户一样填写输入框并点击发送按钮。
   */
  const textarea = page.locator('textarea').first();
  await textarea.fill(text);
  await textarea.press('Control+Enter');
  await expect(page.locator('.chat-message.user').filter({ hasText: text })).toHaveCount(1);
}

/**
 * Return the captured codex-command that the real composer sent.
 */
async function waitForCodexCommand(page, prompt: string): Promise<Record<string, unknown>> {
  /**
   * docstring：该断言证明测试确实通过 Codex composer 发送，而不是手动拼了 UI 状态。
   */
  await expect.poll(async () => page.evaluate((expectedPrompt) => {
    const messages = window.__capturedWsMessages || [];
    const command = messages.find((message) => (
      message
      && typeof message === 'object'
      && message.type === 'codex-command'
      && message.command === expectedPrompt
    ));
    return command?.clientRequestId || '';
  }, prompt), { timeout: 5000 }).not.toBe('');

  return page.evaluate((expectedPrompt) => {
    const messages = window.__capturedWsMessages || [];
    return messages.find((message) => (
      message
      && typeof message === 'object'
      && message.type === 'codex-command'
      && message.command === expectedPrompt
    ));
  }, prompt);
}

/**
 * Emit a scoped WebSocket message for the currently viewed cN session.
 */
async function emitCodexSocketMessage(page, routeSessionId: string, message: Record<string, unknown>): Promise<void> {
  /**
   * docstring：所有注入事件都带 cN 身份，防止测试误通过未加 scope 的全局消息。
   */
  await page.evaluate((payload) => {
    window.__emitCbwSocketMessage?.(payload);
  }, {
    provider: 'codex',
    sessionId: routeSessionId,
    ozwSessionId: routeSessionId,
    ozw_session_id: routeSessionId,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    ...message,
  });
}

/**
 * Read visible chat rows in DOM order.
 */
async function getChatRows(page): Promise<string[]> {
  /**
   * docstring：最终验收看用户实际看到的消息顺序，而不是看内部数组或网络响应。
   */
  return page.locator('.chat-message').evaluateAll((rows) =>
    rows
      .map((row) => (row.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
}

/**
 * Count visible chat rows containing a piece of text.
 */
function countRowsContaining(rows: string[], text: string): number {
  /**
   * docstring：用户消息只允许出现一次；重复 optimistic 和 persisted 用户气泡会让这里大于 1。
   */
  return rows.filter((row) => row.includes(text)).length;
}

/**
 * Check whether the expected texts appear in chat row order.
 */
function rowsContainInOrder(rows: string[], expectedTexts: string[]): boolean {
  /**
   * docstring：只要求文本出现在越来越靠后的 chat row 中，
   * 不依赖具体头像、时间、provider 标签或样式文案。
   */
  let searchFrom = 0;
  for (const expectedText of expectedTexts) {
    const foundIndex = rows.findIndex((row, index) => index >= searchFrom && row.includes(expectedText));
    if (foundIndex < 0) {
      return false;
    }
    searchFrom = foundIndex + 1;
  }
  return true;
}

/**
 * Persist screenshot, transcript state, and runtime-noise evidence for review.
 */
async function saveEvidence(page, scenarioId: string, recorder): Promise<void> {
  /**
   * docstring：截图给人工复查视觉结果，state snapshot 给自动复查消息顺序，
   * console-network 文件说明测试过程中是否有额外前端运行时错误。
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const rows = await getChatRows(page);
  const transcriptPath = path.join(EVIDENCE_DIR, 'transcript-state.json');
  const noisePath = path.join(EVIDENCE_DIR, 'console-network.json');

  let transcriptState: Record<string, unknown> = {};
  let noiseState: Record<string, unknown> = {};
  try {
    transcriptState = JSON.parse(await fs.readFile(transcriptPath, 'utf8'));
  } catch {
    transcriptState = {};
  }
  try {
    noiseState = JSON.parse(await fs.readFile(noisePath, 'utf8'));
  } catch {
    noiseState = {};
  }

  transcriptState[scenarioId] = rows;
  noiseState[scenarioId] = recorder;

  try {
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${scenarioId}.png`), timeout: 3000 });
  } catch (error) {
    noiseState[scenarioId] = {
      ...recorder,
      screenshotError: error instanceof Error ? error.message : String(error),
    };
  }

  await fs.writeFile(transcriptPath, `${JSON.stringify(transcriptState, null, 2)}\n`, 'utf8');
  await fs.writeFile(noisePath, `${JSON.stringify(noiseState, null, 2)}\n`, 'utf8');
}

/**
 * Assert the browser did not report unexplained runtime or network failures.
 */
function expectNoRuntimeNoise(recorder): void {
  /**
   * docstring：严格端到端验收不能在隐藏 console error 或失败请求的情况下算通过。
   */
  expect(recorder.consoleErrors, 'browser console errors').toEqual([]);
  expect(recorder.pageErrors, 'browser page errors').toEqual([]);
  expect(recorder.failedRequests, 'failed browser requests').toEqual([]);
}

test.beforeEach(async ({ page }) => {
  /**
   * 每个场景先重置隔离 fixture，再写入本场景专用 JSONL，避免两个端到端测试互相污染。
   */
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  await authenticatePage(page);
  await installCodexSocketHarness(page);
});

test('第二轮 Codex live 推送期间上一轮 assistant 正文不丢失', async ({ page, request }) => {
  /**
   * 业务场景：用户在已有第一轮结果的手动会话里继续提问，Codex 开始 live 输出时，
   * 第一轮响应正文必须一直在屏幕上，不能等完成重载后才回来。
   */
  const recorder = attachNoiseRecorder(page);
  const sessionId = 'proposal-79-live-prefix-preserved';
  const firstUser = '第一轮用户消息：请说明当前状态。';
  const firstAssistant = '第一轮 assistant 正文：已经完成初始检查，这段文字不能在第二轮 live 时消失。';
  const secondUser = '第二轮用户消息：继续检查并给出下一步。';
  const secondAssistantLive = '第二轮 live assistant 正文：正在继续检查，旧正文应该仍然可见。';

  await writeCodexSession(sessionId, [
    sessionMeta(sessionId),
    userEvent('2026-06-06T01:00:01.000Z', firstUser),
    assistantMessage('2026-06-06T01:00:02.000Z', firstAssistant),
  ]);

  const route = await openManualCodexRoute(page, request, sessionId);
  const transcript = page.locator('[data-testid="chat-scroll-container"]');
  await expect(transcript).toContainText(firstAssistant);

  await submitUserMessage(page, secondUser);
  const command = await waitForCodexCommand(page, secondUser);
  const commandRouteId =
    command.ozwSessionId
    || command.ozw_session_id
    || command.options?.ozwSessionId
    || command.options?.ozw_session_id;
  expect(commandRouteId).toBe(route.routeSessionId);

  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'message-accepted',
    clientRequestId: command.clientRequestId,
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'session-status',
    isProcessing: true,
    turnId: `turn-${command.clientRequestId}`,
    turn_id: `turn-${command.clientRequestId}`,
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      message: {
        role: 'assistant',
        phase: 'commentary',
        content: secondAssistantLive,
      },
    },
  });

  await expect(transcript).toContainText(firstAssistant);
  await expect(transcript).toContainText(secondAssistantLive);
  await expect.poll(async () => {
    const rows = await getChatRows(page);
    return rowsContainInOrder(rows, [firstUser, firstAssistant, secondUser, secondAssistantLive]);
  }, { timeout: 5000 }).toBe(true);

  await saveEvidence(page, 'live-prefix-preserved', recorder);
  expectNoRuntimeNoise(recorder);
});

test('Codex 完成重载后第二轮用户消息显示在本轮响应上方且只出现一次', async ({ page, request }) => {
  /**
   * 业务场景：第二轮响应完成后，前端会重新加载 JSONL 历史。
   * 此时第二轮用户消息必须保留在第二轮 assistant 上面，不能被 optimistic merge 追加到末尾。
   */
  const recorder = attachNoiseRecorder(page);
  const sessionId = 'proposal-79-completion-order';
  const firstUser = '第一轮用户消息：先给出初始结论。';
  const firstAssistant = '第一轮 assistant 正文：初始结论已经写入 JSONL。';
  const secondUser = '第二轮用户消息：请继续完成最终结论。';
  const secondAssistantFinal = '第二轮 assistant 正文：最终结论已经完成，用户消息必须在我上方。';

  await writeCodexSession(sessionId, [
    sessionMeta(sessionId),
    userEvent('2026-06-06T02:00:01.000Z', firstUser),
    assistantMessage('2026-06-06T02:00:02.000Z', firstAssistant),
  ]);

  const route = await openManualCodexRoute(page, request, sessionId);
  const transcript = page.locator('[data-testid="chat-scroll-container"]');
  await expect(transcript).toContainText(firstAssistant);

  await submitUserMessage(page, secondUser);
  const command = await waitForCodexCommand(page, secondUser);
  const commandRouteId =
    command.ozwSessionId
    || command.ozw_session_id
    || command.options?.ozwSessionId
    || command.options?.ozw_session_id;
  expect(commandRouteId).toBe(route.routeSessionId);

  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'message-accepted',
    clientRequestId: command.clientRequestId,
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      message: {
        role: 'assistant',
        phase: 'commentary',
        content: secondAssistantFinal,
      },
    },
  });
  await expect(transcript).toContainText(secondAssistantFinal);

  await appendCodexEntries(sessionId, [
    userEvent('2026-06-06T02:00:03.000Z', secondUser),
    assistantMessage('2026-06-06T02:00:04.000Z', secondAssistantFinal),
    eventMsg('2026-06-06T02:00:05.000Z', 'task_complete'),
  ]);

  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'codex-complete',
    status: 'completed',
    actualSessionId: route.providerSessionId,
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'projects_updated',
    watchProvider: 'codex',
  });

  await expect.poll(async () => {
    const rows = await getChatRows(page);
    return rowsContainInOrder(rows, [firstUser, firstAssistant, secondUser, secondAssistantFinal])
      && countRowsContaining(rows, secondUser) === 1;
  }, { timeout: 10_000 }).toBe(true);

  const rows = await getChatRows(page);
  expect(countRowsContaining(rows, secondUser)).toBe(1);
  expect(rowsContainInOrder(rows, [firstUser, firstAssistant, secondUser, secondAssistantFinal])).toBe(true);
  expect(rowsContainInOrder(rows, [secondAssistantFinal, secondUser])).toBe(false);

  await saveEvidence(page, 'completion-order', recorder);
  expectNoRuntimeNoise(recorder);
});
