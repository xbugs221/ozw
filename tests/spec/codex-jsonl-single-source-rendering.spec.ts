// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: 验收 Codex 会话消息统一从 JSONL 单一路径解析、去重、排序并稳定渲染。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_LABEL,
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.ts';

const SPEC_PATH =
  'openspec/changes/20-unify-codex-jsonl-rendering/specs/codex-jsonl-message-rendering/spec.md';
const SESSION_DAY = ['2026', '04', '24'];

/**
 * Resolve the fixture Codex session file path for a session id.
 *
 * @param {string} sessionId
 * @returns {string}
 */
function codexSessionPath(sessionId) {
  return path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', ...SESSION_DAY, `${sessionId}.jsonl`);
}

/**
 * Write a Codex JSONL transcript under the isolated Playwright HOME.
 *
 * @param {{ sessionId: string, entries: Array<Record<string, unknown>> }} params
 * @returns {Promise<void>}
 */
async function writeCodexSession({ sessionId, entries }) {
  const sessionPath = codexSessionPath(sessionId);
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

/**
 * Append JSONL entries to an existing Codex session file.
 *
 * @param {string} sessionId
 * @param {Array<Record<string, unknown>>} entries
 * @returns {Promise<void>}
 */
async function appendCodexEntries(sessionId, entries) {
  await fs.appendFile(codexSessionPath(sessionId), `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

/**
 * Build a standard session metadata row.
 *
 * @param {string} sessionId
 * @returns {Record<string, unknown>}
 */
function sessionMeta(sessionId) {
  return {
    type: 'session_meta',
    timestamp: '2026-04-24T10:00:00.000Z',
    payload: {
      id: sessionId,
      cwd: PRIMARY_FIXTURE_PROJECT_PATH,
      model: 'gpt-5-codex',
    },
  };
}

/**
 * Build a Codex JSONL response item.
 *
 * @param {string} timestamp
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function responseItem(timestamp, payload) {
  return { type: 'response_item', timestamp, payload };
}

/**
 * Build a visible assistant message row.
 *
 * @param {string} timestamp
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function assistantMessage(timestamp, text) {
  return responseItem(timestamp, {
    type: 'message',
    role: 'assistant',
    phase: 'commentary',
    content: [{ type: 'output_text', text }],
  });
}

/**
 * Build a visible user message row.
 *
 * @param {string} timestamp
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function userMessage(timestamp, text) {
  return responseItem(timestamp, {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
  });
}

/**
 * Build a non-rendered event row that still consumes JSONL cursor position.
 *
 * @param {string} timestamp
 * @param {string} type
 * @returns {Record<string, unknown>}
 */
function eventMsg(timestamp, type) {
  return { type: 'event_msg', timestamp, payload: { type } };
}

/**
 * Build a Codex tool call row.
 *
 * @param {string} timestamp
 * @param {string} callId
 * @param {string} command
 * @returns {Record<string, unknown>}
 */
function toolCall(timestamp, callId, command) {
  return responseItem(timestamp, {
    type: 'function_call',
    call_id: callId,
    name: 'exec_command',
    arguments: JSON.stringify({ cmd: command, workdir: PRIMARY_FIXTURE_PROJECT_PATH }),
  });
}

/**
 * Build a Codex tool output row.
 *
 * @param {string} timestamp
 * @param {string} callId
 * @param {string} output
 * @returns {Record<string, unknown>}
 */
function toolOutput(timestamp, callId, output) {
  return responseItem(timestamp, {
    type: 'function_call_output',
    call_id: callId,
    output,
  });
}

/**
 * Install a test WebSocket replacement so tests can deliver status and refresh
 * notifications without depending on a real Codex process.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function installCodexNotificationSocket(page) {
  await page.addInitScript(() => {
    class FakeWebSocket extends EventTarget {
      constructor() {
        super();
        window.__codexNotificationSocket = this;
        setTimeout(() => {
          this.readyState = WebSocket.OPEN;
          this.__opened = true;
          this.onopen?.();
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(payload) {
        try {
          const message = JSON.parse(payload);
          if (message.type === 'check-session-status') {
            this.__ozwCodexBridge = true;
          }
        } catch {
          this.__ozwCodexBridge = true;
        }
      }

      close() {
        this.readyState = WebSocket.CLOSED;
        this.onclose?.();
        this.dispatchEvent(new Event('close'));
      }
    }

    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;
    window.WebSocket = FakeWebSocket;
    window.__emitCodexNotification = (message) => {
      const socket = window.__codexNotificationSocket;
      const sessionId = window.location.pathname.split('/').filter(Boolean).pop();
      const event = new MessageEvent('message', {
        data: JSON.stringify({ sessionId, ...message }),
      });
      socket?.onmessage?.(event);
      socket?.dispatchEvent?.(event);
    };
  });
}

/**
 * Open a Codex session route scoped to the fixture project.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function openCodexSession(page, sessionId) {
  const params = new URLSearchParams({
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
  });
  await page.goto(`/session/${sessionId}?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
}

/**
 * Notify the frontend that the selected session has new persisted JSONL rows.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function notifyJsonlChanged(page) {
  await page.evaluate(() => {
    window.__emitCodexNotification?.({ type: 'projects_updated', watchProvider: 'codex' });
  });
}

/**
 * Count plain-text occurrences in the rendered page body.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} needle
 * @returns {Promise<number>}
 */
async function countBodyText(page, needle) {
  const text = (await page.locator('body').textContent()) || '';
  return text.split(needle).length - 1;
}

/**
 * Expand a completed tool output details block and assert its persisted output.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} callId
 * @param {string} output
 * @returns {Promise<void>}
 */
async function expectToolOutput(page, callId, output) {
  const result = page.locator(`#tool-result-${callId}`);
  const pre = result.locator('pre').filter({ hasText: output }).first();
  if (!(await pre.isVisible().catch(() => false))) {
    await result.locator('summary').first().click();
  }
  await expect(pre).toContainText(output);
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('selected-provider', 'codex');
  });
  await installCodexNotificationSocket(page);
});

test.describe('Codex JSONL 单一来源消息渲染', () => {
  test('运行中的 Codex 状态更新不得清除已渲染消息', async ({ page }) => {
    /** Scenario: Running Codex turn preserves previously rendered messages */
    const sessionId = 'jsonl-single-source-running-preserves-prefix';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        userMessage('2026-04-24T10:00:01.000Z', '请检查 JSONL 单一路径。'),
        assistantMessage('2026-04-24T10:00:02.000Z', '已从 JSONL 渲染的前缀消息。'),
      ],
    });

    await openCodexSession(page, sessionId);
    await expect(page.locator('body')).toContainText('已从 JSONL 渲染的前缀消息。');
    await page.evaluate(() => {
      window.__emitCodexNotification?.({ type: 'session-status', isProcessing: true });
      window.__emitCodexNotification?.({
        type: 'codex-response',
        data: { type: 'item', message: { content: '这条 WS 内容不应成为消息列表事实。' } },
      });
    });

    await expect(page.locator('body')).toContainText('已从 JSONL 渲染的前缀消息。');
    await expect(page.locator('body')).not.toContainText('这条 WS 内容不应成为消息列表事实。');
  });

  test('刷新浏览器后恢复已落盘的 Codex 前缀', async ({ page }) => {
    /** Scenario: Browser refresh restores the persisted prefix */
    const sessionId = 'jsonl-single-source-refresh-prefix';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        assistantMessage('2026-04-24T10:01:00.000Z', '刷新前已经落盘的正文。'),
        toolCall('2026-04-24T10:01:01.000Z', 'call_refresh_prefix', 'pwd'),
      ],
    });

    await openCodexSession(page, sessionId);
    await expect(page.locator('body')).toContainText('刷新前已经落盘的正文。');
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.locator('body')).toContainText('刷新前已经落盘的正文。');
    await expect(page.locator('body')).toContainText('pwd');
  });

  test('重复文件变化通知不得重复渲染消息', async ({ page }) => {
    /** Scenario: Repeated file-change notification is idempotent */
    const sessionId = 'jsonl-single-source-repeated-notification';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        assistantMessage('2026-04-24T10:02:00.000Z', '重复通知只应出现一次。'),
      ],
    });

    await openCodexSession(page, sessionId);
    await notifyJsonlChanged(page);
    await notifyJsonlChanged(page);

    await expect.poll(() => countBodyText(page, '重复通知只应出现一次。')).toBe(1);
  });

  test('非渲染 JSONL 行不得导致增量游标跳错', async ({ page }) => {
    /** Scenario: Filtered JSONL rows do not move the cursor incorrectly */
    const sessionId = 'jsonl-single-source-filtered-cursor';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        assistantMessage('2026-04-24T10:03:00.000Z', '游标测试第一条可见消息。'),
        eventMsg('2026-04-24T10:03:01.000Z', 'token_count'),
        eventMsg('2026-04-24T10:03:02.000Z', 'turn_context'),
      ],
    });

    await openCodexSession(page, sessionId);
    await appendCodexEntries(sessionId, [
      eventMsg('2026-04-24T10:03:03.000Z', 'token_count'),
      assistantMessage('2026-04-24T10:03:04.000Z', '游标测试第二条可见消息。'),
    ]);
    await notifyJsonlChanged(page);

    await expect(page.locator('body')).toContainText('游标测试第一条可见消息。');
    await expect(page.locator('body')).toContainText('游标测试第二条可见消息。');
  });

  test('工具输出按 call_id 完成既有工具卡片', async ({ page }) => {
    /** Scenario: Tool output completes the existing card */
    const sessionId = 'jsonl-single-source-tool-output-completes-card';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        toolCall('2026-04-24T10:04:00.000Z', 'call_complete_card', 'printf complete-card'),
      ],
    });

    await openCodexSession(page, sessionId);
    await appendCodexEntries(sessionId, [
      toolOutput('2026-04-24T10:04:01.000Z', 'call_complete_card', 'complete-card output\n'),
    ]);
    await notifyJsonlChanged(page);

    await expect(page.locator('body')).toContainText('printf complete-card');
    await expectToolOutput(page, 'call_complete_card', 'complete-card output');
    await expect.poll(() => countBodyText(page, 'printf complete-card')).toBe(1);
  });

  test('完成的工具卡片刷新后仍只渲染一次', async ({ page }) => {
    /** Scenario: Tool card remains stable across refresh */
    const sessionId = 'jsonl-single-source-tool-refresh-stable';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        toolCall('2026-04-24T10:05:00.000Z', 'call_refresh_stable', 'git status --short'),
        toolOutput('2026-04-24T10:05:01.000Z', 'call_refresh_stable', ' M src/example.js\n'),
      ],
    });

    await openCodexSession(page, sessionId);
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.locator('body')).toContainText('git status --short');
    await expectToolOutput(page, 'call_refresh_stable', 'src/example.js');
    await expect.poll(() => countBodyText(page, 'git status --short')).toBe(1);
  });

  test('reasoning、toolcall、tool result、正文按 JSONL 逻辑顺序渲染', async ({ page }) => {
    /** Scenario: Interleaved reasoning, tool call, and assistant text render in order */
    const sessionId = 'jsonl-single-source-logical-order';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        responseItem('2026-04-24T10:06:00.000Z', {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: '先判断需要检查仓库状态。' }],
        }),
        toolCall('2026-04-24T10:06:01.000Z', 'call_logical_order', 'git status --short'),
        toolOutput('2026-04-24T10:06:02.000Z', 'call_logical_order', 'clean\n'),
        assistantMessage('2026-04-24T10:06:03.000Z', '仓库状态已经检查完成。'),
      ],
    });

    await openCodexSession(page, sessionId);
    const text = (await page.locator('body').textContent()) || '';

    expect(text.indexOf('先判断需要检查仓库状态。')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('git status --short')).toBeGreaterThan(text.indexOf('先判断需要检查仓库状态。'));
    await expectToolOutput(page, 'call_logical_order', 'clean');
    const expandedText = (await page.getByTestId('chat-scroll-container').textContent()) || '';
    expect(expandedText.indexOf('仓库状态已经检查完成。')).toBeGreaterThan(expandedText.indexOf('clean'));
  });

  test('新增 JSONL 增量追加在已渲染前缀之后', async ({ page }) => {
    /** Scenario: New increments append after existing persisted messages */
    const sessionId = 'jsonl-single-source-increment-appends';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        assistantMessage('2026-04-24T10:07:00.000Z', '增量前缀消息。'),
      ],
    });

    await openCodexSession(page, sessionId);
    await appendCodexEntries(sessionId, [
      assistantMessage('2026-04-24T10:07:01.000Z', '增量追加消息。'),
    ]);
    await notifyJsonlChanged(page);

    await expect.poll(() => countBodyText(page, '增量追加消息。')).toBe(1);
    const text = (await page.locator('body').textContent()) || '';
    expect(text.indexOf('增量前缀消息。')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('增量追加消息。')).toBeGreaterThan(text.indexOf('增量前缀消息。'));
  });

  test('session-status 只能更新状态不能覆盖消息内容', async ({ page }) => {
    /** Scenario: Status changes do not overwrite message content */
    const sessionId = 'jsonl-single-source-status-does-not-overwrite';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        assistantMessage('2026-04-24T10:08:00.000Z', '状态更新前已存在的 JSONL 消息。'),
      ],
    });

    await openCodexSession(page, sessionId);
    await page.evaluate(() => {
      window.__emitCodexNotification?.({ type: 'session-status', isProcessing: true });
      window.__emitCodexNotification?.({ type: 'session-status', isProcessing: false });
    });

    await expect(page.locator('body')).toContainText('状态更新前已存在的 JSONL 消息。');
    await expect.poll(() => countBodyText(page, '状态更新前已存在的 JSONL 消息。')).toBe(1);
  });

  test('Codex 完成后最终状态来自 JSONL 而不是 realtime placeholder', async ({ page }) => {
    /** Scenario: Completion reloads final JSONL state */
    const sessionId = 'jsonl-single-source-completion-final-sync';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        toolCall('2026-04-24T10:09:00.000Z', 'call_final_sync', 'printf final-sync'),
      ],
    });

    await openCodexSession(page, sessionId);
    await page.evaluate(() => {
      window.__emitCodexNotification?.({
        type: 'codex-response',
        data: { type: 'item', message: { content: 'realtime placeholder should disappear' } },
      });
    });
    await appendCodexEntries(sessionId, [
      toolOutput('2026-04-24T10:09:01.000Z', 'call_final_sync', 'final-sync output\n'),
      eventMsg('2026-04-24T10:09:02.000Z', 'task_complete'),
    ]);
    await page.evaluate(() => {
      window.__emitCodexNotification?.({ type: 'codex-complete', status: 'completed' });
    });
    await notifyJsonlChanged(page);

    await expectToolOutput(page, 'call_final_sync', 'final-sync output');
    await expect(page.locator('body')).not.toContainText('realtime placeholder should disappear');
  });

  test('Codex 完成后同一 assistant 不得同时保留 WS 和 JSONL 副本', async ({ page }) => {
    /** Scenario: Completion reconciles duplicate live and persisted assistant text */
    const sessionId = 'jsonl-single-source-completion-live-dedup';
    const assistantText = '完成后这条 assistant 只能显示一次。';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        userMessage('2026-04-24T10:10:00.000Z', '验证完成事件去重。'),
      ],
    });

    await openCodexSession(page, sessionId);
    await page.evaluate((text) => {
      window.__emitCodexNotification?.({
        type: 'codex-response',
        data: {
          type: 'item',
          itemType: 'agent_message',
          itemId: 'live-final-assistant',
          message: { role: 'assistant', content: text },
        },
      });
    }, assistantText);
    await expect(page.locator('body')).toContainText(assistantText);

    await appendCodexEntries(sessionId, [
      assistantMessage('2026-04-24T10:10:03.000Z', assistantText),
      eventMsg('2026-04-24T10:10:04.000Z', 'task_complete'),
    ]);
    await page.evaluate(() => {
      window.__emitCodexNotification?.({ type: 'codex-complete', status: 'completed' });
    });
    await notifyJsonlChanged(page);

    await expect.poll(() => countBodyText(page, assistantText)).toBe(1);
  });

  test('Codex 完成后同一工具卡不得同时保留 WS 和 JSONL 副本', async ({ page }) => {
    /** Scenario: Completion reconciles duplicate live and persisted tool cards */
    const sessionId = 'jsonl-single-source-completion-live-tool-dedup';
    const command = 'pnpm run live-tool-dedupe';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        userMessage('2026-04-24T10:10:10.000Z', '验证完成事件工具卡去重。'),
      ],
    });

    await openCodexSession(page, sessionId);
    await page.evaluate((cmd) => {
      window.__emitCodexNotification?.({
        type: 'codex-response',
        data: {
          type: 'item',
          itemType: 'function_call',
          itemId: 'call_live_tool_dedup',
          call_id: 'call_live_tool_dedup',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd }),
        },
      });
    }, command);
    await expect(page.locator('body')).toContainText(command);

    await appendCodexEntries(sessionId, [
      toolCall('2026-04-24T10:10:13.000Z', 'call_live_tool_dedup', command),
      toolOutput('2026-04-24T10:10:14.000Z', 'call_live_tool_dedup', 'live-tool-dedupe passed\n'),
      eventMsg('2026-04-24T10:10:15.000Z', 'task_complete'),
    ]);
    await page.evaluate(() => {
      window.__emitCodexNotification?.({ type: 'codex-complete', status: 'completed' });
    });
    await notifyJsonlChanged(page);

    await expect.poll(() => countBodyText(page, command)).toBe(1);
    await expectToolOutput(page, 'call_live_tool_dedup', 'live-tool-dedupe passed');
  });

  test('Codex 完成后不得保留未落盘的 live 工具卡片', async ({ page }) => {
    /** Scenario: Terminal reload makes the visible transcript match a hard refresh */
    const sessionId = 'jsonl-single-source-completion-drops-stale-live-tool';
    const staleLiveCommand = 'pnpm run stale-live-only';
    const persistedCommand = 'pnpm run persisted-after-complete';
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        userMessage('2026-04-24T10:10:20.000Z', '验证完成后清理未落盘 live 工具卡。'),
      ],
    });

    await openCodexSession(page, sessionId);
    await page.evaluate((cmd) => {
      window.__emitCodexNotification?.({
        type: 'codex-response',
        data: {
          type: 'item',
          itemType: 'function_call',
          itemId: 'call_stale_live_only',
          call_id: 'call_stale_live_only',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd }),
        },
      });
    }, staleLiveCommand);
    await expect(page.locator('body')).toContainText(staleLiveCommand);

    await appendCodexEntries(sessionId, [
      toolCall('2026-04-24T10:10:23.000Z', 'call_persisted_after_complete', persistedCommand),
      toolOutput('2026-04-24T10:10:24.000Z', 'call_persisted_after_complete', 'persisted command passed\n'),
      eventMsg('2026-04-24T10:10:25.000Z', 'task_complete'),
    ]);
    await page.evaluate(() => {
      window.__emitCodexNotification?.({ type: 'codex-complete', status: 'completed' });
    });
    await notifyJsonlChanged(page);

    await expect(page.locator('body')).toContainText(persistedCommand);
    await expectToolOutput(page, 'call_persisted_after_complete', 'persisted command passed');
    await expect(page.locator('body')).not.toContainText(staleLiveCommand);
    if (process.env.CBW_DEBUG_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.CBW_DEBUG_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.CBW_DEBUG_SCREENSHOT_DIR, 'codex-complete-drops-stale-live-tool.png'),
        fullPage: true,
      });
    }
  });

  test('文件更新 JSON 响应不得作为 assistant 正文渲染', async ({ page }) => {
    /** Scenario: Provider file-update bookkeeping JSON is hidden from chat transcript */
    const sessionId = 'jsonl-single-source-file-update-json-hidden';
    const fileUpdateJson = JSON.stringify({
      path: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts',
      kind: 'update',
    }, null, 2);
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        userMessage('2026-04-24T10:11:00.000Z', '运行针对性测试验证'),
        assistantMessage('2026-04-24T10:11:01.000Z', fileUpdateJson),
        assistantMessage('2026-04-24T10:11:02.000Z', '验证完成。'),
      ],
    });

    await openCodexSession(page, sessionId);

    await expect(page.locator('body')).toContainText('验证完成。');
    await expect(page.locator('body')).not.toContainText('JSON 响应');
    await expect(page.getByTestId('codex-tool-card').filter({ hasText: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts' }).first()).toBeVisible();
  });

  test('跟随模式的 output_text 文件更新 JSON 不得作为 assistant 正文渲染', async ({ page }) => {
    /** Scenario: Follow-latest live agent_message hides provider file-update JSON */
    const sessionId = 'jsonl-single-source-live-file-update-json-hidden';
    const fileUpdateJson = JSON.stringify({
      path: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts',
      kind: 'update',
    }, null, 2);
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        userMessage('2026-04-24T10:12:00.000Z', '点击跟随后不要显示 provider 文件更新 JSON'),
      ],
    });

    await openCodexSession(page, sessionId);
    await page.getByTestId('chat-follow-latest').click();
    await page.evaluate((jsonText) => {
      window.__emitCodexNotification?.({
        type: 'codex-response',
        data: {
          type: 'item',
          itemType: 'agent_message',
          itemId: 'live-file-update-output-text',
          message: {
            role: 'assistant',
            content: [{ type: 'output_text', text: jsonText }],
          },
        },
      });
    }, fileUpdateJson);

    await expect(page.locator('body')).toContainText('点击跟随后不要显示 provider 文件更新 JSON');
    await expect(page.locator('body')).not.toContainText('JSON 响应');
    await expect(page.getByTestId('codex-tool-card').filter({ hasText: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts' }).first()).toBeVisible();
  });

  test('滚动到底部释放冻结尾部时不得恢复 stale live 文件更新 JSON', async ({ page }) => {
    /** Scenario: Bottom-scroll refresh drops stale live bookkeeping rows kept in memory */
    const sessionId = 'jsonl-single-source-scroll-bottom-stale-live-json-hidden';
    const fileUpdateJson = JSON.stringify({
      path: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts',
      kind: 'update',
    }, null, 2);
    await page.addInitScript(({ projectName, jsonText }) => {
      window.localStorage.setItem(`chat_messages_${projectName}`, JSON.stringify([
        {
          type: 'assistant',
          content: jsonText,
          timestamp: '2026-04-24T10:13:01.000Z',
          source: 'codex-live',
          messageKey: 'codex-live:stale-file-update-json',
        },
      ]));
    }, { projectName: PRIMARY_FIXTURE_LABEL, jsonText: fileUpdateJson });
    await writeCodexSession({
      sessionId,
      entries: [
        sessionMeta(sessionId),
        userMessage('2026-04-24T10:13:00.000Z', '滚动到底部后不要恢复 stale live JSON'),
      ],
    });

    await openCodexSession(page, sessionId);
    await page.getByTestId('chat-scroll-container').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await expect(page.locator('body')).toContainText('滚动到底部后不要恢复 stale live JSON');
    await expect(page.locator('body')).not.toContainText('JSON 响应');
    await expect(page.locator('body')).not.toContainText('/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts');
  });
});
