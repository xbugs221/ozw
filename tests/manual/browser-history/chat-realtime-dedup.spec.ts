// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify the browser dedupes replayed co/Codex realtime events against persisted history.
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

async function writeIdleCoConversation() {
  /** Create persisted c51 history that the page loads through the server REST path. */
  await fs.mkdir(path.join(coHome, 'conversations', 'c51'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'turns', 'turn_history'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'requests', 'done'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c51', 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c51',
    provider: 'codex',
    project_path: PRIMARY_FIXTURE_PROJECT_PATH,
    provider_session_id: 'provider_c51',
    status: 'idle',
    active_turn_id: '',
    turns: ['turn_history'],
  }));
  await fs.writeFile(path.join(coHome, 'requests', 'done', 'req_history.json'), JSON.stringify({
    request_id: 'req_history',
    conversation_id: 'c51',
    turn_id: 'turn_history',
    created_at: '2026-05-10T10:00:00.000Z',
    text: 'ping',
  }));
  await fs.writeFile(path.join(coHome, 'turns', 'turn_history', 'events.jsonl'), `${JSON.stringify({
    type: 'codex-response',
    provider: 'codex',
    conversation_id: 'c51',
    turn_id: 'turn_history',
    seq: 0,
    data: { type: 'item', itemType: 'agent_message', message: { content: 'CO_QUEUE_1_OK' } },
  })}\n`);
}

async function installReplaySocket(page) {
  /** Replay the same co event twice while leaving REST history loading real. */
  await page.addInitScript(() => {
    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 1;

      constructor() {
        super();
        setTimeout(() => {
          this.onopen?.(new Event('open'));
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(payload) {
        const message = JSON.parse(payload);
        if (message.type !== 'check-session-status') {
          return;
        }
        const replay = {
          type: 'codex-response',
          sessionId: 'c51',
          ozwSessionId: 'c51',
          conversation_id: 'c51',
          turn_id: 'turn_history',
          seq: 0,
          data: { type: 'item', itemType: 'agent_message', message: { content: 'CO_QUEUE_1_OK' } },
        };
        for (const event of [replay, replay, { type: 'session-status', sessionId: 'c51', ozwSessionId: 'c51', isProcessing: false }]) {
          this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
        }
      }

      close() {
        this.readyState = 3;
        this.onclose?.(new Event('close'));
      }
    }
    window.WebSocket = FakeWebSocket;
  });
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
  await writeIdleCoConversation();
  await installReplaySocket(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('selected-provider', 'codex');
  });
});

test('persisted cN history is not duplicated by replayed realtime agent_message events', async ({ page }) => {
  /** Scenario: REST history plus repeated WS replay for the same event stays single-copy. */
  const params = new URLSearchParams({ provider: 'codex', projectPath: PRIMARY_FIXTURE_PROJECT_PATH });
  await page.goto(`/session/c51?${params.toString()}`, { waitUntil: 'networkidle' });

  await expect(page.getByText('CO_QUEUE_1_OK')).toHaveCount(1);
});
