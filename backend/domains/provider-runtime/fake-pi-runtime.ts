/**
 * 文件目的：隔离浏览器测试使用的 fake Pi runtime。
 * 业务意义：真实 runtime-router 不直接承载测试专用的 Pi 流式模拟逻辑。
 */
import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import { completeProviderLiveTranscriptSnapshot, recordProviderLiveTranscriptEvent } from './live-transcript-store.js';
import { toProviderMessageAcceptedEvent, toProviderRuntimeCompleteEvent, toProviderRuntimeResponseEvent, toProviderSessionCreatedEvent, toProviderSessionQueueStateEvent, toProviderSessionStatusEvent } from './provider-runtime-events.js';
import type { PiSessionRecord } from './runtime-session-store.js';
import type { RunningBehavior } from './runtime-router.js';

const FAKE_PI_TURN_DELAY_MS = 5000;

/**
 * 判断当前进程是否应使用 fake Pi runtime。
 */
export function shouldUseFakePiRuntime(): boolean {
  return process.env.CCFLOW_FAKE_RUNNER === '1' || process.env.CBW_FAKE_PI_RUNTIME === '1';
}

const windowlessSetTimeout = (callback: () => void | Promise<void>, delayMs: number) => {
  setTimeout(() => { void callback(); }, delayMs);
};

async function appendFakePiTranscript(session: PiSessionRecord, providerSessionId: string, text: string): Promise<void> {
  /**
   * Persist fake Pi JSONL in the same shape the production read model scans.
   */
  const sessionDir = path.join(os.homedir(), '.pi', 'agent', 'sessions', 'playwright');
  const filePath = path.join(sessionDir, `${providerSessionId}.jsonl`);
  const now = new Date().toISOString();
  await fsp.mkdir(sessionDir, { recursive: true });

  const rows: string[] = [];
  try {
    await fsp.access(filePath);
  } catch {
    rows.push(JSON.stringify({
      type: 'session',
      id: providerSessionId,
      cwd: session.projectPath,
      timestamp: now,
    }));
  }

  rows.push(JSON.stringify({
    type: 'message',
    id: `${providerSessionId}-user-${Date.now()}`,
    timestamp: now,
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  }));
  rows.push(JSON.stringify({
    type: 'message',
    id: `${providerSessionId}-assistant-${Date.now()}`,
    timestamp: new Date(Date.now() + 1).toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: `fake pi response: ${text}` }],
    },
  }));

  await fsp.appendFile(filePath, `${rows.join('\n')}\n`, 'utf8');
}

export function runFakePiTurn(session: PiSessionRecord, text: string, runningBehavior: RunningBehavior | undefined, options: {
  clientRequestId?: string | null;
}): { accepted: boolean; providerSessionId: string } {
  /**
   * Simulate Pi streaming semantics for browser tests without real Pi credentials.
   */
  const providerSessionId = session.fakeProviderSessionId || `provider_${session.ozwSessionId}`;
  session.fakeProviderSessionId = providerSessionId;
  const wasRunning = (session.status as string) === 'running';
  const behavior = wasRunning ? (runningBehavior || 'steer') : undefined;
  session.status = 'running';
  if (!wasRunning || !session.turnStartedAt) {
    session.turnStartedAt = new Date().toISOString();
  }
  session.events.push({ type: 'fake_pi_prompt', text, behavior });
  session.writer?.send(toProviderSessionCreatedEvent({
    provider: 'pi',
    sessionId: providerSessionId,
    clientRequestId: options.clientRequestId || null,
  }));
  session.writer?.send(toProviderSessionStatusEvent({
    provider: 'pi',
    sessionId: providerSessionId,
    isProcessing: true,
    turnId: `turn_${options.clientRequestId || providerSessionId}`,
    turnStartedAt: session.turnStartedAt || undefined,
  }));
  if (wasRunning) {
    session.writer?.send(toProviderSessionQueueStateEvent({
      provider: 'pi',
      sessionId: providerSessionId,
      steering: behavior === 'steer' ? [text] : [],
      followUp: behavior === 'followUp' ? [text] : [],
    }));
  }
  session.writer?.send(toProviderMessageAcceptedEvent({
    provider: 'pi',
    sessionId: providerSessionId,
    clientRequestId: options.clientRequestId || null,
  }));

  windowlessSetTimeout(async () => {
    if ((session.status as string) === 'aborted') return;
    await appendFakePiTranscript(session, providerSessionId, text);
    const finalData = {
      type: 'item',
      itemType: 'agent_message',
      itemId: `${providerSessionId}-${Date.now()}`,
      message: { role: 'assistant', content: `fake pi response: ${text}` },
    };
    recordProviderLiveTranscriptEvent('pi', providerSessionId, session.projectPath, finalData);
    completeProviderLiveTranscriptSnapshot('pi', providerSessionId, session.projectPath);
    session.writer?.send(toProviderRuntimeResponseEvent({ provider: 'pi', data: finalData, sessionId: providerSessionId }));
    session.writer?.send(toProviderRuntimeCompleteEvent({ provider: 'pi', sessionId: providerSessionId, actualSessionId: providerSessionId }));
    session.writer?.send(toProviderSessionStatusEvent({
      provider: 'pi',
      sessionId: providerSessionId,
      isProcessing: false,
      turnId: `turn_${options.clientRequestId || providerSessionId}`,
    }));
    session.status = 'completed';
    session.turnStartedAt = null;
  }, FAKE_PI_TURN_DELAY_MS);

  return { accepted: true, providerSessionId };
}
