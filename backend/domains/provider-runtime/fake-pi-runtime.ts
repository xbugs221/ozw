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

type FakePiTurnArtifacts = {
  marker: string;
  toolCallId: string;
  thinking: string;
  command: string;
  result: string;
  response: string;
};

/**
 * 判断当前进程是否应使用 fake Pi runtime。
 */
export function shouldUseFakePiRuntime(): boolean {
  return process.env.CCFLOW_FAKE_RUNNER === '1' || process.env.OZW_FAKE_PI_RUNTIME === '1';
}

const windowlessSetTimeout = (callback: () => void | Promise<void>, delayMs: number) => {
  setTimeout(() => { void callback(); }, delayMs);
};

function extractFakePiMarker(text: string): string {
  /**
   * Keep fake runtime rows concise while preserving a stable prompt marker.
   */
  const explicitMarker = text.match(/pi live ws turn \d+ \d+/)?.[0];
  if (explicitMarker) {
    return explicitMarker;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 80) || 'pi fake turn';
}

function buildFakePiTurnArtifacts(providerSessionId: string, text: string): FakePiTurnArtifacts {
  /**
   * Build deterministic thinking, tool, and final response payloads for one turn.
   */
  const marker = extractFakePiMarker(text);
  const safeMarker = marker.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'turn';
  const toolCallId = `${providerSessionId}-${safeMarker}-${Date.now()}-tool`;
  const command = `printf "fake pi tool for ${marker}"`;
  return {
    marker,
    toolCallId,
    thinking: `fake pi thinking: ${marker}`,
    command,
    result: `fake pi tool result for ${marker}: websocket payload reached the provider runtime.`,
    response: [
      `fake pi response: ${marker}`,
      'I inspected the live WebSocket rendering path and kept this answer long enough to exercise merge timing.',
      'The visible transcript should retain the reasoning row, the tool card, and the final assistant text while JSONL catches up.',
      `fake pi long live conclusion for ${marker}: live rows must remain visible before and after the read-model refresh.`,
    ].join('\n\n'),
  };
}

function recordFakePiLiveEvent(session: PiSessionRecord, providerSessionId: string, data: Record<string, unknown>): void {
  /**
   * Send one fake runtime event and mirror it into refresh-recovery snapshots.
   */
  session.writer?.send(toProviderRuntimeResponseEvent({ provider: 'pi', data, sessionId: providerSessionId }));
  recordProviderLiveTranscriptEvent('pi', providerSessionId, session.projectPath, data);
  if (session.ozwSessionId !== providerSessionId) {
    recordProviderLiveTranscriptEvent('pi', session.ozwSessionId, session.projectPath, data);
  }
}

async function appendFakePiTranscript(
  session: PiSessionRecord,
  providerSessionId: string,
  text: string,
  artifacts: FakePiTurnArtifacts,
): Promise<void> {
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
    id: `${providerSessionId}-assistant-plan-${Date.now()}`,
    timestamp: new Date(Date.now() + 1).toISOString(),
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', text: artifacts.thinking },
        {
          type: 'toolCall',
          id: artifacts.toolCallId,
          name: 'Bash',
          input: { command: artifacts.command },
        },
      ],
    },
  }));
  rows.push(JSON.stringify({
    type: 'message',
    id: `${providerSessionId}-tool-result-${Date.now()}`,
    timestamp: new Date(Date.now() + 2).toISOString(),
    message: {
      role: 'toolResult',
      toolCallId: artifacts.toolCallId,
      toolName: 'Bash',
      content: artifacts.result,
    },
  }));
  rows.push(JSON.stringify({
    type: 'message',
    id: `${providerSessionId}-assistant-final-${Date.now()}`,
    timestamp: new Date(Date.now() + 3).toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: artifacts.response }],
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
  const artifacts = buildFakePiTurnArtifacts(providerSessionId, text);
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

  windowlessSetTimeout(() => {
    if ((session.status as string) === 'aborted') return;
    recordFakePiLiveEvent(session, providerSessionId, {
      type: 'item',
      itemType: 'reasoning',
      itemId: `${artifacts.toolCallId}-thinking`,
      status: 'completed',
      message: { role: 'assistant', content: artifacts.thinking },
    });
  }, 100);

  windowlessSetTimeout(() => {
    if ((session.status as string) === 'aborted') return;
    recordFakePiLiveEvent(session, providerSessionId, {
      type: 'item',
      itemType: 'tool_call',
      itemId: artifacts.toolCallId,
      tool: 'Bash',
      input: { command: artifacts.command },
      status: 'running',
    });
  }, 200);

  windowlessSetTimeout(() => {
    if ((session.status as string) === 'aborted') return;
    recordFakePiLiveEvent(session, providerSessionId, {
      type: 'item',
      itemType: 'tool_result',
      itemId: artifacts.toolCallId,
      tool: 'Bash',
      result: artifacts.result,
      status: 'completed',
    });
  }, 300);

  windowlessSetTimeout(async () => {
    if ((session.status as string) === 'aborted') return;
    await appendFakePiTranscript(session, providerSessionId, text, artifacts);
    const finalData = {
      type: 'item',
      itemType: 'agent_message',
      itemId: `${providerSessionId}-${Date.now()}`,
      message: { role: 'assistant', content: artifacts.response },
    };
    recordFakePiLiveEvent(session, providerSessionId, finalData);
    completeProviderLiveTranscriptSnapshot('pi', providerSessionId, session.projectPath);
    if (session.ozwSessionId !== providerSessionId) {
      completeProviderLiveTranscriptSnapshot('pi', session.ozwSessionId, session.projectPath);
    }
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
