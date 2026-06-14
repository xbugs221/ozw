// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify across Codex/Pi that:
 *   1. Realtime agent_message payloads do NOT enter the DOM transcript directly.
 *   2. A content event triggers read-model invalidation, and after a provider-
 *      complete event the freshly persisted read-model content appears (Codex).
 *   3. Duplicate events do not cause duplicated DOM entries.
 *
 *   spec:  「运行中 provider 内容事件不直接插入 transcript」
 *         「持久化 read model 更新后按权威顺序显示」
 *         「重复推送不会重复渲染」
 *   tasks: 3.1, 3.2, 5.1, 5.2
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.ts';

const coHome = process.env.CCFLOW_CO_HOME || path.join(process.cwd(), '.tmp', 'playwright-co-home');

/** Content that comes from the initial persisted read model. */
const PERSISTED_CONTENT = 'PERSISTED_INITIAL_MSG';

/** Content that is only sent via realtime WS and MUST NOT leak into DOM. */
const REALTIME_NOISE = 'REALTIME_LEAK_IF_BUG';

/** Content written to the read model AFTER page load; must appear after reload. */
const RELOADED_CONTENT = 'RELOADED_AUTHORITATIVE_MSG';

// ── Provider parameterisation ──────────────────────────────────────────────

interface ProviderConfig {
  provider: string;
  label: string;
  wsResponseType: string;
  wsCompleteType: string;
  conversationId: string;
}

/** All three providers share the same convergent realtime handler structure. */
const ALL_PROVIDERS: ProviderConfig[] = [
  { provider: 'codex', label: 'Codex', wsResponseType: 'codex-response', wsCompleteType: 'codex-complete', conversationId: 'c60' },
  { provider: 'pi', label: 'Pi', wsResponseType: 'pi-response', wsCompleteType: 'pi-complete', conversationId: 'c62' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function writeInitialPersistedHistory(cfg: ProviderConfig) {
  const turnId = `turn_${cfg.conversationId}`;
  await fs.mkdir(path.join(coHome, 'conversations', cfg.conversationId), { recursive: true });
  await fs.mkdir(path.join(coHome, 'turns', turnId), { recursive: true });
  await fs.mkdir(path.join(coHome, 'requests', 'done'), { recursive: true });

  await fs.writeFile(path.join(coHome, 'conversations', cfg.conversationId, 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: cfg.conversationId,
    provider: cfg.provider,
    project_path: PRIMARY_FIXTURE_PROJECT_PATH,
    provider_session_id: `provider_${cfg.conversationId}`,
    status: 'idle',
    active_turn_id: '',
    turns: [turnId],
  }));

  await fs.writeFile(path.join(coHome, 'requests', 'done', `req_${cfg.conversationId}.json`), JSON.stringify({
    request_id: `req_${cfg.conversationId}`,
    conversation_id: cfg.conversationId,
    turn_id: turnId,
    created_at: '2026-05-17T10:00:00.000Z',
    text: 'hello',
  }));

  await fs.writeFile(path.join(coHome, 'turns', turnId, 'events.jsonl'), `${JSON.stringify({
    type: cfg.wsResponseType,
    provider: cfg.provider,
    conversation_id: cfg.conversationId,
    turn_id: turnId,
    seq: 0,
    data: { type: 'item', itemType: 'agent_message', message: { content: PERSISTED_CONTENT } },
  })}\n`);
}

async function appendContentToPersistedHistory(cfg: ProviderConfig) {
  const turnId = `turn_${cfg.conversationId}`;
  await fs.appendFile(path.join(coHome, 'turns', turnId, 'events.jsonl'), `${JSON.stringify({
    type: cfg.wsResponseType,
    provider: cfg.provider,
    conversation_id: cfg.conversationId,
    turn_id: turnId,
    seq: 1,
    data: { type: 'item', itemType: 'agent_message', message: { content: RELOADED_CONTENT } },
  })}\n`);
}

async function installFakeWebSocket(page, cfg: ProviderConfig) {
  /**
   * Inject a FakeWebSocket that sends a realtime-only agent_message on
   * check-session-status and exposes window.__ozwTriggerReload() so the
   * test can request a provider-complete event at a controlled time.
   *
   * IMPORTANT: page.addInitScript registers per browser context — every call
   * adds a script that runs on ALL subsequent page navigations.  Multiple
   * calls accumulate and later FakeWebSocket classes overwrite earlier ones.
   * To keep each test correct, __ozwTriggerReload() resolves the provider
   * dynamically from the page URL at call time rather than using a closure.
   */
  await page.addInitScript(() => {
    let wsInstance: any = null;

    const resolveFromUrl = () => {
      const p = new URLSearchParams(window.location.search).get('provider') || 'codex';
      const cid = (window.location.pathname.match(/\/(c\d+)$/) || [])[1] || 'c60';
      return { provider: p, conversationId: cid };
    };

    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 1;

      constructor() {
        super();
        wsInstance = this;
        setTimeout(() => {
          this.onopen?.(new Event('open'));
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(payload: string) {
        const message = JSON.parse(payload);
        if (message.type === 'check-session-status') {
          const { provider: p, conversationId: cid } = resolveFromUrl();
          const respType = `${p}-response`;
          const realtimeNoise = {
            type: respType,
            sessionId: cid,
            ozwSessionId: cid,
            conversation_id: cid,
            turn_id: `turn_${cid}`,
            seq: 0,
            data: { type: 'item', itemType: 'agent_message', message: { content: 'REALTIME_LEAK_IF_BUG' } },
          };

          for (const event of [
            realtimeNoise,
            realtimeNoise,
            { type: 'session-status', sessionId: cid, ozwSessionId: cid, isProcessing: false },
          ]) {
            this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
          }
        }
      }

      close() {
        this.readyState = 3;
        this.onclose?.(new Event('close'));
      }
    }
    window.WebSocket = FakeWebSocket as any;

    (window as any).__ozwTriggerReload = () => {
      if (wsInstance && wsInstance.onmessage) {
        const { provider: p, conversationId: cid } = resolveFromUrl();
        wsInstance.onmessage(new MessageEvent('message', {
          data: JSON.stringify({
            type: `${p}-complete`,
            sessionId: cid,
            ozwSessionId: cid,
            conversation_id: cid,
          }),
        }));
      }
    };
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

for (const cfg of ALL_PROVIDERS) {
  test.describe(`${cfg.label} provider – realtime content convergence`, () => {
    test.beforeEach(async ({ page }) => {
      await resetWorkspaceProject();
      await authenticatePage(page);
      await writeInitialPersistedHistory(cfg);
      await installFakeWebSocket(page, cfg);
      await page.addInitScript((provider) => {
        window.localStorage.setItem('selected-provider', provider);
      }, cfg.provider);
    });

    test('realtime agent_message payload does NOT leak into DOM; persisted read-model content IS visible', async ({ page }) => {
      const params = new URLSearchParams({
        provider: cfg.provider,
        projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
      });
      await page.goto(`/session/${cfg.conversationId}?${params.toString()}`, {
        waitUntil: 'networkidle',
      });

      // Persisted content is visible via the read-model path.
      await expect(page.getByText(PERSISTED_CONTENT)).toBeVisible({ timeout: 10_000 });

      // Realtime-only payload must never appear in the DOM.
      await expect(page.getByText(REALTIME_NOISE)).not.toBeAttached({ timeout: 5_000 });

      // Persisted content must appear exactly once (no duplication).
      await expect(page.getByText(PERSISTED_CONTENT)).toHaveCount(1);
    });
  });
}

// ── Codex-specific: content-event → complete → reload → DOM update ─────────
test.describe('Codex provider – content-event triggers read-model reload', () => {
  const cfg = ALL_PROVIDERS[0]; // Codex

  test.beforeEach(async ({ page }) => {
    await resetWorkspaceProject();
    await authenticatePage(page);
    await writeInitialPersistedHistory(cfg);
    await installFakeWebSocket(page, cfg);
    await page.addInitScript(() => {
      window.localStorage.setItem('selected-provider', 'codex');
    });
  });

  test('after content event + read-model update + complete, authoritative content appears via reload', async ({ page }) => {
    const params = new URLSearchParams({
      provider: 'codex',
      projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    });

    // 1. Load the session — only initial persisted content is visible.
    await page.goto(`/session/${cfg.conversationId}?${params.toString()}`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByText(PERSISTED_CONTENT)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(REALTIME_NOISE)).not.toBeAttached({ timeout: 5_000 });

    // 2. Append NEW persisted content to the durable read model on disk.
    await appendContentToPersistedHistory(cfg);

    // 3. Trigger a codex-complete event via FakeWS → reloadCodexSessionMessages.
    await page.evaluate(() => {
      (window as any).__ozwTriggerReload?.();
    });

    // 4. After reload, the newly persisted authoritative content must appear.
    await expect(page.getByText(RELOADED_CONTENT)).toBeVisible({
      timeout: 15_000,
    });

    // 5. Realtime-only noise must STILL not appear.
    await expect(page.getByText(REALTIME_NOISE)).not.toBeAttached({ timeout: 5_000 });

    // 6. Old persisted content must not be duplicated.
    await expect(page.getByText(PERSISTED_CONTENT)).toHaveCount(1);
  });
});

// ── Pi: content-event → complete → reload → DOM update ──────────────────
//
// The pi-complete handler calls reloadCodexSessionMessages unconditionally just
// like codex-complete.  The onNavigateToSession guard only fires when
// pendingSessionId is in sessionStorage AND currentSessionId is null, which is
// not true when a session is already loaded on-screen.

test.describe('Pi provider – content-event triggers read-model reload', () => {
  const cfg = ALL_PROVIDERS[1]; // Pi
  test.beforeEach(async ({ page }) => {
    await resetWorkspaceProject();
    await authenticatePage(page);
    await writeInitialPersistedHistory(cfg);
    await installFakeWebSocket(page, cfg);
    await page.addInitScript(() => {
      window.localStorage.setItem('selected-provider', 'pi');
    });
  });

  test('after content event + read-model update + complete, authoritative content appears via reload', async ({ page }) => {
    const params = new URLSearchParams({
      provider: cfg.provider,
      projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    });
    await page.goto(`/session/${cfg.conversationId}?${params.toString()}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(PERSISTED_CONTENT)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(REALTIME_NOISE)).not.toBeAttached({ timeout: 5_000 });

    await appendContentToPersistedHistory(cfg);
    await page.evaluate(() => { (window as any).__ozwTriggerReload?.(); });

    await expect(page.getByText(RELOADED_CONTENT)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(REALTIME_NOISE)).not.toBeAttached({ timeout: 5_000 });
    await expect(page.getByText(PERSISTED_CONTENT)).toHaveCount(1);
  });
});
