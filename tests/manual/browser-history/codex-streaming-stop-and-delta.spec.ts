// @ts-nocheck -- Proposal contract test uses browser-injected helpers.
/**
 * PURPOSE: 验收 Codex 手动会话刷新后停止按钮恢复、文本 delta 增量追加、
 * 以及协议 JSON 不被渲染为聊天正文。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from '../../spec/helpers/spec-test-helpers.ts';

const SESSION_DAY = ['2026', '06', '03'];

/**
 * Resolve the fixture Codex JSONL path for a proposal test session.
 *
 * @param {string} sessionId
 * @returns {string}
 */
function codexSessionPath(sessionId) {
  return path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', ...SESSION_DAY, `${sessionId}.jsonl`);
}

/**
 * Write a minimal Codex session so the real app can open the session route.
 *
 * @param {string} sessionId
 * @param {string} [assistantText]
 * @returns {Promise<void>}
 */
async function writeCodexSession(sessionId, assistantText = '刷新前已有的 Codex 消息。') {
  const sessionPath = codexSessionPath(sessionId);
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  const entries = [
    {
      type: 'session_meta',
      timestamp: '2026-06-03T10:00:00.000Z',
      payload: {
        id: sessionId,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        model: 'gpt-5-codex',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-03T10:00:01.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: assistantText }],
      },
    },
  ];
  await fs.writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

/**
 * Install a fake WebSocket that can answer status checks and capture abort requests.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function installCodexRuntimeSocket(page) {
  await page.addInitScript(() => {
    window.__ozwSentMessages = [];
    // Use sessionStorage so status survives page reload.
    const STATUS_KEY = '__ozw_runtime_status';
    const loadStatusMap = () => {
      try {
        const raw = sessionStorage.getItem(STATUS_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    };
    const saveStatusMap = (map) => {
      try {
        sessionStorage.setItem(STATUS_KEY, JSON.stringify(map));
      } catch { /* noop */ }
    };
    class FakeWebSocket extends EventTarget {
      constructor() {
        super();
        window.__ozwRuntimeSocket = this;
        setTimeout(() => {
          this.readyState = WebSocket.OPEN;
          this.onopen?.();
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(payload) {
        const message = JSON.parse(payload);
        window.__ozwSentMessages.push(message);
        if (message.type === 'check-session-status') {
          const statusMap = loadStatusMap();
          // Try route-based ozwSessionId first, then provider sessionId.
          const lookupKey = message.ozwSessionId || message.sessionId;
          let status = statusMap[lookupKey] || {};
          if (!status.isProcessing && message.ozwSessionId && message.sessionId !== message.ozwSessionId) {
            status = statusMap[message.sessionId] || status;
          }
          window.__emitCodexRuntimeMessage?.({
            type: 'session-status',
            provider: 'codex',
            sessionId: message.sessionId,
            ozwSessionId: message.ozwSessionId || null,
            isProcessing: Boolean(status.isProcessing),
            turnId: status.turnId || 'turn_live_refresh',
          });
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
    window.__emitCodexRuntimeMessage = (message) => {
      const socket = window.__ozwRuntimeSocket;
      const sessionId = window.location.pathname.split('/').filter(Boolean).pop();
      const event = new MessageEvent('message', {
        data: JSON.stringify({ sessionId, provider: 'codex', ...message }),
      });
      socket?.onmessage?.(event);
      socket?.dispatchEvent?.(event);
    };
    window.__setCodexRuntimeStatus = (sessionId, status) => {
      const statusMap = loadStatusMap();
      statusMap[sessionId] = status;
      saveStatusMap(statusMap);
    };
  });
}

/**
 * Open a Codex session route under the isolated fixture project.
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
 * Count visible body text occurrences.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} needle
 * @returns {Promise<number>}
 */
async function countBodyText(page, needle) {
  const text = (await page.locator('body').textContent()) || '';
  return text.split(needle).length - 1;
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('selected-provider', 'codex');
  });
  await installCodexRuntimeSocket(page);
});

test.describe('Codex 流式停止和增量渲染', () => {
  test('刷新运行中的 Codex 会话后停止按钮仍可用并发送 abort', async ({ page }) => {
    /** Scenario: after a page refresh while Codex is running, the stop button
     * must be visible and sending abort must target the current provider session. */
    const sessionId = 'proposal-66-refresh-running-stop';
    await writeCodexSession(sessionId);
    await openCodexSession(page, sessionId);

    // Wait for the session to fully load and currentSessionId to be set.
    await expect(page.locator('code')).toContainText(sessionId);

    // Store a running status in sessionStorage so the fake WebSocket returns
    // isProcessing=true after the page reload.
    await page.evaluate((id) => {
      window.__setCodexRuntimeStatus?.(id, { isProcessing: true, turnId: 'turn_after_refresh' });
    }, sessionId);

    // Reload to exercise the full refresh-recovery path: the app must send
    // check-session-status, receive isProcessing=true, and restore the stop button.
    await page.reload({ waitUntil: 'networkidle' });
    // Allow React effects (especially session resolution and isLoading state)
    // to settle after the reload.
    await page.waitForTimeout(2000);

    // The stop button must appear when isLoading becomes true.
    const stopButton = page.getByRole('button', { name: /停止|stop/i });
    await expect(stopButton).toBeVisible({ timeout: 10000 });
    // Use Escape key to trigger abort (avoids click-through timing issues).
    await page.keyboard.press('Escape');

    // Verify abort-session was sent with the correct provider session.
    // After the implementation fix, sessionId must carry the concrete provider
    // session ID (not a route-based cN alias).
    await expect.poll(async () => {
      return page.evaluate((id) => {
        return window.__ozwSentMessages.some((message) =>
          message.type === 'abort-session'
          && message.provider === 'codex'
          && (message.sessionId === id || message.ozwSessionId === id));
      }, sessionId);
    }, { timeout: 15000 }).toBe(true);
  });

  test('Codex 同一 assistant 文本 delta 中途追加显示且不反复抹除', async ({ page }) => {
    /** Scenario: live text deltas append into one assistant row. */
    const sessionId = 'proposal-66-live-delta-append';
    const finalText = '这是一段流式回答';
    await writeCodexSession(sessionId, 'delta 前缀。');
    await openCodexSession(page, sessionId);
    await page.evaluate(() => {
      window.__emitCodexRuntimeMessage?.({ type: 'session-status', provider: 'codex', isProcessing: true });
    });

    for (const chunk of ['这是', '一段', '流式回答']) {
      await page.evaluate((text) => {
        window.__emitCodexRuntimeMessage?.({
          type: 'codex-response',
          provider: 'codex',
          data: {
            type: 'item',
            itemType: 'agent_message',
            itemId: 'agent-message-delta-1',
            delta: { text },
            message: { role: 'assistant' },
          },
        });
      }, chunk);
    }

    await expect(page.locator('body')).toContainText(finalText);
    await expect.poll(() => countBodyText(page, finalText)).toBe(1);
    await expect(page.locator('body')).not.toContainText('这是流式回答');
  });

  test('Codex 协议对象不会作为奇怪 JSON 渲染到正文', async ({ page }) => {
    /** Scenario: protocol payloads are filtered instead of rendered as text. */
    const sessionId = 'proposal-66-json-payload-filter';
    await writeCodexSession(sessionId, '已有正文不能被协议对象清空。');
    await openCodexSession(page, sessionId);

    await page.evaluate(() => {
      window.__emitCodexRuntimeMessage?.({
        type: 'codex-response',
        provider: 'codex',
        data: {
          type: 'item',
          itemType: 'agent_message',
          itemId: 'protocol-object-1',
          delta: {
            content_part: {
              type: 'internal_protocol_state',
              payload: { seq: 7, nested: { shouldNotRender: true } },
            },
          },
        },
      });
    });

    await expect(page.locator('body')).toContainText('已有正文不能被协议对象清空。');
    await expect(page.locator('body')).not.toContainText('"itemId"');
    await expect(page.locator('body')).not.toContainText('protocol-object-1');
    await expect(page.locator('body')).not.toContainText('internal_protocol_state');
    await expect(page.locator('body')).not.toContainText('shouldNotRender');
  });
});
