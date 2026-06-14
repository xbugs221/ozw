// @ts-nocheck -- Acceptance regression is allowed to fail until proposal 66 is implemented.
/**
 * PURPOSE: Verify proposal 66 Codex running-state recovery through the real
 * browser session route, including abort failure state, repeated stop attempts,
 * refresh recovery, and deterministic QA evidence.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PLAYWRIGHT_FIXTURE_HOME } from './helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from '../spec/helpers/spec-test-helpers.ts';

const SESSION_DAY = ['2026', '06', '03'];
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/codex-session-66-streaming-stop-state');
const FAILURE_TEXT = 'Stop request failed. The session is still running.';
const INTERRUPTED_TEXT = 'Session interrupted by user.';
const PERSISTED_TEXT = 'proposal 66 stop state persisted transcript remains visible.';

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
  await installCodexAbortStateSocket(page);
});

test('Codex stop state survives abort failure, repeated stop, success, and refresh', async ({ page }) => {
  /**
   * Scenario: A running Codex session restored after refresh remains stoppable;
   * a failed stop keeps the session running, a repeated stop succeeds once, and
   * a later refresh reflects the idle state without transcript corruption.
   */
  const sessionId = 'proposal-66-root-stop-failure-repeat-refresh';
  await writeCodexSession(sessionId);

  await openCodexSession(page, sessionId);
  await setRuntimeStatus(page, sessionId, true);
  await page.reload({ waitUntil: 'networkidle' });

  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  const stopButton = page.getByRole('button', { name: /停止|stop/i });
  await expect(transcript).toContainText(PERSISTED_TEXT);
  await expect(stopButton).toBeVisible();

  await stopButton.click();
  await expect(transcript).toContainText(FAILURE_TEXT);
  await expect(transcript).toContainText(PERSISTED_TEXT);
  await expect(stopButton).toBeVisible();
  await expect.poll(() => abortCount(page, sessionId)).toBe(1);

  await stopButton.click();
  await expect.poll(() => abortCount(page, sessionId)).toBe(2);
  // After a successful abort, reloadCodexSessionMessages(preserveLiveMessages:false)
  // replaces the chat with JSONL data. Wait for the reload to settle before
  // asserting the post-abort idle state.
  await page.waitForTimeout(1000);
  await expect(stopButton).toHaveCount(0);
  await expect(transcript).toContainText(PERSISTED_TEXT);

  await page.reload({ waitUntil: 'networkidle' });
  const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(page.getByRole('button', { name: /停止|stop/i })).toHaveCount(0);
  await expect(reloadedTranscript).toContainText(PERSISTED_TEXT);
  await expect(reloadedTranscript).not.toContainText(FAILURE_TEXT);

  await writeEvidence(page, sessionId);
});

async function writeCodexSession(sessionId) {
  /**
   * Write a minimal persisted Codex transcript so the session route opens the
   * same JSONL-backed history a real user sees after reopening a manual session.
   */
  const sessionPath = path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', ...SESSION_DAY, `${sessionId}.jsonl`);
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
        content: [{ type: 'output_text', text: PERSISTED_TEXT }],
      },
    },
  ];
  await fs.writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

async function installCodexAbortStateSocket(page) {
  /**
   * Replace the browser WebSocket with a deterministic Codex runtime socket that
   * persists sent frames and running state in localStorage across page refreshes.
   */
  await page.addInitScript(() => {
    const sentKey = '__proposal66SentMessages';
    const statusKey = (sessionId) => `__proposal66Status:${sessionId}`;
    const abortKey = (sessionId) => `__proposal66AbortCount:${sessionId}`;

    function readJson(key, fallback) {
      try {
        return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback));
      } catch {
        return fallback;
      }
    }

    function writeJson(key, value) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }

    function routeSessionId() {
      return window.location.pathname.split('/').filter(Boolean).pop() || '';
    }

    class FakeWebSocket extends EventTarget {
      constructor() {
        super();
        window.__proposal66RuntimeSocket = this;
        setTimeout(() => {
          this.readyState = WebSocket.OPEN;
          this.onopen?.();
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(payload) {
        const message = JSON.parse(payload);
        const sentMessages = readJson(sentKey, []);
        sentMessages.push(message);
        writeJson(sentKey, sentMessages);

        if (message.type === 'check-session-status') {
          const lookupId = message.ozwSessionId || message.sessionId || routeSessionId();
          let status = readJson(statusKey(lookupId), { isProcessing: false });
          // Fall back to provider sessionId if route-based lookup found nothing.
          if (!status.isProcessing && message.ozwSessionId && message.sessionId !== message.ozwSessionId) {
            status = readJson(statusKey(message.sessionId), { isProcessing: false });
          }
          window.__proposal66EmitRuntimeMessage?.({
            type: 'session-status',
            provider: 'codex',
            sessionId: message.sessionId || lookupId,
            ozwSessionId: message.ozwSessionId || null,
            isProcessing: Boolean(status.isProcessing),
            turnId: status.turnId || 'turn_proposal66_running',
          });
        }

        if (message.type === 'abort-session') {
          const lookupId = message.ozwSessionId || message.sessionId || routeSessionId();
          const nextCount = Number(window.localStorage.getItem(abortKey(lookupId)) || '0') + 1;
          window.localStorage.setItem(abortKey(lookupId), String(nextCount));
          // Also track under the provider sessionId so the test's abortCount()
          // can verify with the provider ID even when ozwSessionId is a route alias.
          if (message.ozwSessionId && message.sessionId && message.ozwSessionId !== message.sessionId) {
            window.localStorage.setItem(abortKey(message.sessionId), String(nextCount));
          }
          if (nextCount === 1) {
            window.__proposal66EmitRuntimeMessage?.({
              type: 'session-aborted',
              provider: 'codex',
              sessionId: message.sessionId || lookupId,
              success: false,
            });
            return;
          }

          writeJson(statusKey(message.sessionId || lookupId), { isProcessing: false });
          window.__proposal66EmitRuntimeMessage?.({
            type: 'session-aborted',
            provider: 'codex',
            sessionId: message.sessionId || lookupId,
            success: true,
          });
          window.__proposal66EmitRuntimeMessage?.({
            type: 'session-status',
            provider: 'codex',
            sessionId: message.sessionId || lookupId,
            isProcessing: false,
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
    window.__proposal66EmitRuntimeMessage = (message) => {
      const socket = window.__proposal66RuntimeSocket;
      const sessionId = message.sessionId || routeSessionId();
      const event = new MessageEvent('message', {
        data: JSON.stringify({ sessionId, provider: 'codex', ...message }),
      });
      socket?.onmessage?.(event);
      socket?.dispatchEvent?.(event);
    };
    window.__proposal66SetRuntimeStatus = (sessionId, status) => {
      writeJson(statusKey(sessionId), status);
    };
    window.__proposal66AbortCount = (sessionId) => Number(window.localStorage.getItem(abortKey(sessionId)) || '0');
    window.__proposal66SentMessages = () => readJson(sentKey, []);
  });
}

async function openCodexSession(page, sessionId) {
  /**
   * Open the proposal session through the normal manual-session route with an
   * explicit provider and project path, matching the user's restored-session path.
   */
  await page.addInitScript(() => {
    window.localStorage.setItem('selected-provider', 'codex');
  });
  const params = new URLSearchParams({
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: 'proposal 66 root stop-state regression',
  });
  await page.goto(`/session/${sessionId}?${params.toString()}`, { waitUntil: 'networkidle' });
}

async function setRuntimeStatus(page, sessionId, isProcessing) {
  /**
   * Store fake runtime state in browser storage so check-session-status after a
   * browser refresh returns the intended running or idle status.
   */
  await page.evaluate(({ id, processing }) => {
    window.__proposal66SetRuntimeStatus?.(id, {
      isProcessing: processing,
      turnId: processing ? 'turn_proposal66_running' : null,
    });
  }, { id: sessionId, processing: isProcessing });
}

async function abortCount(page, sessionId) {
  /**
   * Count abort-session frames observed by the browser socket for this session.
   */
  return page.evaluate((id) => window.__proposal66AbortCount?.(id) || 0, sessionId);
}

async function writeEvidence(page, sessionId) {
  /**
   * Persist QA artifacts proving rendered state, outbound network frames, and
   * the post-refresh browser view used for this acceptance contract.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'after-success-refresh.png'),
    fullPage: true,
  });

  const state = await page.evaluate((id) => ({
    sessionId: id,
    bodyText: document.body.textContent || '',
    stopButtonCount: document.querySelectorAll('button[title="Stop"], button[title="停止"]').length,
    abortCount: window.__proposal66AbortCount?.(id) || 0,
    sentMessages: window.__proposal66SentMessages?.() || [],
  }), sessionId);

  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'state-after-success-refresh.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'network-abort-frames.json'),
    `${JSON.stringify({
      sessionId,
      abortMessages: state.sentMessages.filter((message) => message.type === 'abort-session'),
    }, null, 2)}\n`,
    'utf8',
  );
}
