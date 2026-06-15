/**
 * Native Agent Runtime
 * ====================
 *
 * Coordinates Codex app-server manual chat and Pi SDK sessions, replacing the
 * previous co file protocol intermediate layer.
 */

import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from '@earendil-works/pi-coding-agent';
import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import type { ChatMessageLike } from '../../../frontend/components/chat/utils/nativeRuntimeTranscript.js';
import {
  sendCodexAppServerMessage,
  abortCodexAppServerSession,
  getCodexAppServerSessionStatus,
  getActiveCodexAppServerSessions,
} from '../../codex-app-server-runtime.js';
import { StreamingDeltaBatcher } from '../../streaming-delta-batcher.js';
import {
  clearProviderActiveTurnOverlay,
  completeProviderActiveTurnOverlay,
  recordProviderActiveTurnRuntimeEvent,
  recordProviderActiveTurnUser,
} from './active-turn-store.js';
import {
  completeProviderLiveTranscriptSnapshot,
  discardProviderLiveTranscriptSnapshot,
  getProviderCompletedTranscriptSnapshot,
  getProviderLiveTranscriptSnapshot,
  recordProviderLiveTranscriptEvent,
  setProviderLiveTranscriptSnapshot,
  clearProviderLiveTranscriptSnapshot,
} from './live-transcript-store.js';
import {
  type Provider,
  type RuntimeEvent,
  toProviderMessageAcceptedEvent,
  toProviderMessageRejectedEvent,
  toProviderRuntimeCompleteEvent,
  toProviderRuntimeErrorEvent,
  toProviderRuntimeResponseEvent,
  toProviderSessionAbortedEvent,
  toProviderSessionCreatedEvent,
  toProviderSessionQueueStateEvent,
  toProviderSessionStatusEvent,
} from './provider-runtime-events.js';
import { resolveCodexPermissionPolicy } from '../../codex-permission-policy.js';

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

export const PROVIDER_CAPABILITIES = {
  codex: {
    runningInput: ['steer', 'abort-and-send'],
    steer: true,
    followUp: false,
  },
  pi: {
    runningInput: ['steer', 'followUp'],
    steer: true,
    followUp: true,
  },
} as const;

export type RunningBehavior = 'queue' | 'abort-and-send' | 'steer' | 'followUp';
export type { Provider, RuntimeEvent };

// ---------------------------------------------------------------------------
// Session record shapes
// ---------------------------------------------------------------------------

type CodexSessionRecord = {
  provider: 'codex';
  ozwSessionId: string;
  status: 'running' | 'completed' | 'aborted' | 'failed';
  startedAt: string;
  projectPath: string;
  clientRequestId?: string | null;
  writer: RuntimeWriter | null;
  providerThreadId: string | null;
  activeTurnId: string | null;
  turnStartedAt?: string | null;
};

type PiSessionRecord = {
  provider: 'pi';
  ozwSessionId: string;
  status: 'running' | 'completed' | 'aborted' | 'failed';
  session: import('@earendil-works/pi-coding-agent').AgentSession | null;
  startedAt: string;
  projectPath: string;
  clientRequestId?: string | null;
  writer: RuntimeWriter | null;
  events: Array<{ type: string; text?: string; behavior?: string }>;
  lastMessageId: string | null;
  fakeProviderSessionId?: string;
  turnStartedAt?: string | null;
  streamingDeltaBatcher?: StreamingDeltaBatcher;
};
type PiThinkingLevel = NonNullable<import('@earendil-works/pi-coding-agent').AgentSession['thinkingLevel']>;

type SessionRecord = CodexSessionRecord | PiSessionRecord;

// ---------------------------------------------------------------------------
// Writer abstraction (matches WebSocketWriter interface used by backend/index)
// ---------------------------------------------------------------------------

export interface RuntimeWriter {
  send(data: unknown): void;
  setSessionId?(sessionId: string): void;
  setSessionIndexContext?(context: unknown): void;
}

function withActiveTurnOverlayWriter(
  writer: RuntimeWriter | null | undefined,
  provider: Provider,
  sessionId: string,
  projectPath: string,
): RuntimeWriter | null {
  /**
   * Mirror outbound runtime events into the disposable active-turn overlay.
   */
  if (!writer) {
    return null;
  }
  return {
    send(data: unknown): void {
      const message = data && typeof data === 'object' ? data as Record<string, unknown> : null;
      if (message?.type === `${provider}-response` && message.data && typeof message.data === 'object') {
        recordProviderActiveTurnRuntimeEvent({
          provider,
          sessionId,
          projectPath,
          event: message.data as Record<string, unknown>,
        });
      }
      if (message?.type === `${provider}-complete`) {
        completeProviderActiveTurnOverlay(provider, sessionId, projectPath);
      }
      if (message?.type === `${provider}-error` || message?.type === 'session-aborted') {
        clearProviderActiveTurnOverlay(provider, sessionId, projectPath);
      }
      writer.send(data);
    },
    setSessionId(sessionIdValue: string): void {
      writer.setSessionId?.(sessionIdValue);
    },
    setSessionIndexContext(context: unknown): void {
      writer.setSessionIndexContext?.(context);
    },
  };
}

function getPiStreamingDeltaBatcher(session: PiSessionRecord): StreamingDeltaBatcher {
  /**
   * Keep Pi WebSocket delivery and live transcript snapshots aligned while
   * coalescing token-level SDK text deltas.
   */
  if (!session.streamingDeltaBatcher) {
    session.streamingDeltaBatcher = new StreamingDeltaBatcher((event) => {
      session.writer?.send(event);
      const runtimeEvent = event as Record<string, unknown>;
      const providerSessionId = typeof runtimeEvent.sessionId === 'string'
        ? runtimeEvent.sessionId
        : session.session?.sessionId || session.ozwSessionId;
      const payload = runtimeEvent.data && typeof runtimeEvent.data === 'object'
        ? runtimeEvent.data as Record<string, unknown>
        : runtimeEvent;
      recordProviderLiveTranscriptEvent('pi', providerSessionId, session.projectPath, payload);
    });
  }
  return session.streamingDeltaBatcher;
}

function isStreamingTextItem(value: unknown): value is Record<string, unknown> {
  /**
   * Identify provider text deltas that must be batched before browser delivery.
   */
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === 'item'
    && (record.itemType === 'agent_message' || record.itemType === 'reasoning')
    && record.status === 'in_progress'
    && record.delta !== null
    && typeof record.delta === 'object';
}

function getStreamingDeltaText(value: Record<string, unknown>): string {
  /**
   * Extract the normalized text payload from a streaming item.
   */
  const delta = value.delta as Record<string, unknown> | undefined;
  return typeof delta?.text === 'string'
    ? delta.text
    : (typeof delta?.content === 'string' ? delta.content : '');
}


// ---------------------------------------------------------------------------
// Pi event transformation (maps Pi SDK AgentSessionEvent to ozw messages)
// ---------------------------------------------------------------------------

function transformPiEvent(event: Record<string, unknown>): unknown {
  switch (event.type) {
    // Streaming assistant text delta
    case 'message_update': {
      const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
      if (ame?.type === 'text_delta') {
        return { type: 'item', itemType: 'agent_message', itemId: event.messageId || null, status: 'in_progress', delta: { text: ame.delta || '' }, message: { role: 'assistant' } };
      }
      if (ame?.type === 'thinking_delta') {
        return { type: 'item', itemType: 'reasoning', itemId: event.messageId || null, status: 'in_progress', delta: { text: ame.delta || '' }, message: { role: 'assistant', isReasoning: true } };
      }
      return event;
    }
    // Tool execution lifecycle
    case 'tool_execution_start':
      return { type: 'item', itemType: 'tool_call', itemId: event.toolCallId || null, tool: event.toolName, status: 'running' };
    case 'tool_execution_update':
      return { type: 'item', itemType: 'tool_call', itemId: event.toolCallId || null, tool: event.toolName, output: event.output };
    case 'tool_execution_end':
      return { type: 'item', itemType: 'tool_result', itemId: event.toolCallId || null, tool: event.toolName, result: event.output, isError: event.isError, status: 'completed' };
    // Turn lifecycle
    case 'turn_start':
      return { type: 'turn_started', timestamp: typeof event.timestamp === 'number' ? event.timestamp : undefined };
    case 'turn_end': {
      const turnPayload: Record<string, unknown> = { type: 'turn_complete' };
      if (event.toolResults) turnPayload.toolResults = event.toolResults;
      return turnPayload;
    }
    // Message lifecycle (for completion tracking)
    case 'message_start':
    case 'message_end':
      return event;
    case 'error':
      return { type: 'error', message: event.message || 'Pi error' };
    default:
      return event;
  }
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

const sessions = new Map<string, SessionRecord>();
const FAKE_PI_TURN_DELAY_MS = 5000;

function shouldUseFakePiRuntime(): boolean {
  /**
   * Playwright must exercise Pi UX without depending on real local Pi auth.
   */
  return process.env.CCFLOW_FAKE_RUNNER === '1' || process.env.CBW_FAKE_PI_RUNTIME === '1';
}

const windowlessSetTimeout = (callback: () => void | Promise<void>, delayMs: number) => {
  /**
   * Wrap setTimeout so fake runtime intent is readable in server-side tests.
   */
  setTimeout(() => {
    void callback();
  }, delayMs);
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

function runFakePiTurn(session: PiSessionRecord, text: string, runningBehavior: RunningBehavior | undefined, options: {
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

/**
 * Build the in-memory runtime key for one project-scoped cN route.
 */
function getSessionId(provider: Provider, ozwSessionId: string, projectPath = ''): string {
  const normalizedProjectPath = String(projectPath || '').trim();
  return normalizedProjectPath
    ? `${provider}:${normalizedProjectPath}:${ozwSessionId}`
    : `${provider}:${ozwSessionId}`;
}

/**
 * Resolve a runtime session by exact project path, with a legacy fallback for
 * callers that predate projectPath on status/abort requests.
 */
function findRuntimeSession(provider: Provider, ozwSessionId: string, projectPath = ''): SessionRecord | undefined {
  const exact = sessions.get(getSessionId(provider, ozwSessionId, projectPath));
  if (exact) {
    return exact;
  }

  if (!projectPath) {
    for (const session of sessions.values()) {
      if (session.provider === provider && session.ozwSessionId === ozwSessionId) {
        return session;
      }
    }
  }

  return undefined;
}

function getOrCreateCodexSession(ozwSessionId: string, projectPath: string, writer: RuntimeWriter | null): CodexSessionRecord {
  const id = getSessionId('codex', ozwSessionId, projectPath);
  let session = sessions.get(id) as CodexSessionRecord | undefined;
  if (!session) {
    session = {
      provider: 'codex',
      ozwSessionId,
      status: 'completed',
      startedAt: new Date().toISOString(),
      projectPath,
      writer,
      providerThreadId: null,
      activeTurnId: null,
    };
    sessions.set(id, session);
  }
  if (writer) session.writer = writer;
  return session;
}

function getOrCreatePiSession(ozwSessionId: string, projectPath: string, writer: RuntimeWriter | null): PiSessionRecord {
  const id = getSessionId('pi', ozwSessionId, projectPath);
  let session = sessions.get(id) as PiSessionRecord | undefined;
  if (!session) {
    session = {
      provider: 'pi',
      ozwSessionId,
      status: 'completed',
      session: null,
      startedAt: new Date().toISOString(),
      projectPath,
      writer,
      events: [],
      lastMessageId: null,
    };
    sessions.set(id, session);
  }
  if (writer) session.writer = writer;
  return session;
}

// ---------------------------------------------------------------------------
// Live transcript snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Test-only helper: seed a running Pi session into the in-memory store so
 * that handleGetSessionMessages can exercise the merged-jsonl+live branch
 * without requiring a real Pi agent process.
 */
export function seedRunningPiSessionForTest(
  ozwSessionId: string,
  projectPath: string,
  transcriptRows: ChatMessageLike[],
): void {
  const session = getOrCreatePiSession(ozwSessionId, projectPath, null);
  session.status = 'running';
  setProviderLiveTranscriptSnapshot('pi', ozwSessionId, projectPath, transcriptRows);
}

/**
 * Test-only helper: seed a running Codex session into the in-memory store so
 * endpoint tests can verify that cN Codex history is merged with live rows.
 */
export function seedRunningCodexSessionForTest(
  ozwSessionId: string,
  projectPath: string,
  transcriptRows: ChatMessageLike[],
): void {
  const session = getOrCreateCodexSession(ozwSessionId, projectPath, null);
  session.status = 'running';
  setProviderLiveTranscriptSnapshot('codex', ozwSessionId, projectPath, transcriptRows);
}

export {
  getProviderLiveTranscriptSnapshot,
  getProviderCompletedTranscriptSnapshot,
  clearProviderLiveTranscriptSnapshot,
};

export const __nativeAgentRuntimeInternalsForTest = {
  resolveCodexPermissionPolicy,
};

function isCbwRouteSessionId(sessionId: string | null | undefined): boolean {
  return typeof sessionId === 'string' && /^c\d+$/.test(sessionId.trim());
}

// ---------------------------------------------------------------------------
// Pi session file resolution
// ---------------------------------------------------------------------------

async function findPiSessionFile(sessionId: string): Promise<string | null> {
  const normalized = String(sessionId || '').trim();
  if (!normalized || isCbwRouteSessionId(normalized)) return null;

  const sessionsRoot = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  const entries: Array<{ path: string }> = [];
  const walk = async (dir: string) => {
    let dirEntries: import('fs').Dirent[] = [];
    try {
      dirEntries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirEntries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        entries.push({ path: path.join(dir, entry.name) });
      } else if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name));
      }
    }
  };
  await walk(sessionsRoot);

  // Fast path: filename includes the session id
  const filenameMatch = entries.find((e) => path.basename(e.path).includes(normalized));
  if (filenameMatch) return filenameMatch.path;

  // Slow path: read first record id
  for (const entry of entries) {
    try {
      const raw = await fsp.open(entry.path, 'r');
      const stat = await raw.stat();
      const buf = Buffer.alloc(Math.min(stat.size, 4096));
      await raw.read(buf, 0, buf.length, 0);
      await raw.close();
      const firstLine = buf.toString('utf8').split('\n')[0];
      if (!firstLine) continue;
      const record = JSON.parse(firstLine);
      if (record?.id === normalized || record?.session_id === normalized) {
        return entry.path;
      }
    } catch {
      // corrupt/empty session file – skip
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pi runtime
// ---------------------------------------------------------------------------

/**
 * Resolve a provider/model-id selector into the Pi SDK Model object.
 */
function resolvePiModel(modelRegistry: ModelRegistry, modelValue?: string) {
  const value = String(modelValue || '').trim();
  if (!value || !value.includes('/')) {
    return undefined;
  }
  const [provider, ...idParts] = value.split('/');
  return modelRegistry.find(provider, idParts.join('/'));
}

async function ensurePiSession(session: PiSessionRecord, options: {
  model?: string;
  thinkingLevel?: string;
  permissionMode?: string;
  sessionId?: string;
  clientRequestId?: string | null;
}): Promise<void> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const resolvedModel = resolvePiModel(modelRegistry, options.model);
  if (session.session) {
    if ((session.status as string) !== 'running') {
      if (resolvedModel) await session.session.setModel(resolvedModel);
      if (options.thinkingLevel) session.session.setThinkingLevel(options.thinkingLevel as PiThinkingLevel);
      const currentModel = session.session.model;
      session.writer?.send({
        type: 'session-model-state-updated',
        provider: 'pi',
        sessionId: session.ozwSessionId,
        state: {
          model: currentModel?.provider && currentModel?.id ? `${currentModel.provider}/${currentModel.id}` : undefined,
          thinkingLevel: session.session.thinkingLevel,
        },
      });
    }
    return;
  }

  const sessionFilePath = options.sessionId
    ? await findPiSessionFile(options.sessionId)
    : null;

  let piSession: import('@earendil-works/pi-coding-agent').AgentSession;

  if (sessionFilePath) {
    ({ session: piSession } = await createAgentSession({
      sessionManager: SessionManager.open(sessionFilePath),
      model: resolvedModel,
      thinkingLevel: options.thinkingLevel as PiThinkingLevel | undefined,
      modelRegistry,
      authStorage,
    }));
  } else {
    ({ session: piSession } = await createAgentSession({
      cwd: session.projectPath,
      model: resolvedModel,
      thinkingLevel: options.thinkingLevel as PiThinkingLevel | undefined,
      modelRegistry,
      authStorage,
    }));
  }

  session.session = piSession;

  const broadcastPiModelState = () => {
    /**
     * Broadcast the canonical AgentSession state visible through subscribe events.
     */
    const model = piSession.model;
    session.writer?.send({
      type: 'session-model-state-updated',
      provider: 'pi',
      sessionId: session.ozwSessionId,
      state: {
        model: model?.provider && model?.id ? `${model.provider}/${model.id}` : undefined,
        thinkingLevel: piSession.thinkingLevel,
      },
    });
  };

  piSession.subscribe((event) => {
    const ev = event as Record<string, unknown>;
    session.events.push({ type: String(ev.type || ''), text: typeof ev.text === 'string' ? ev.text : undefined });

    // Queue update: steering/followUp state changed
    if (ev.type === 'queue_update') {
      session.writer?.send(toProviderSessionQueueStateEvent({
        provider: 'pi',
        sessionId: piSession.sessionId,
        steering: piSession.getSteeringMessages ? Array.from(piSession.getSteeringMessages()) : [],
        followUp: piSession.getFollowUpMessages ? Array.from(piSession.getFollowUpMessages()) : [],
      }));
      session.writer?.send(toProviderSessionStatusEvent({
        provider: 'pi',
        sessionId: piSession.sessionId,
        isProcessing: piSession.isStreaming,
        turnId: piSession.sessionId,
        turnStartedAt: session.turnStartedAt || undefined,
      }));
      return;
    }

    if (ev.type === 'thinking_level_changed') {
      broadcastPiModelState();
      return;
    }

    // Agent finished: send final assistant message content and pi-complete
    if (ev.type === 'agent_end') {
      getPiStreamingDeltaBatcher(session).flushSession(piSession.sessionId);
      const messages = (ev.messages || []) as Array<Record<string, unknown>>;
      // Find the last assistant message and extract its content.
      // Pi SDK stores assistant content as an array (e.g. [{type:'text',text:'...'}]).
      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
      if (lastAssistant?.content && session.lastMessageId) {
        const contentArray = Array.isArray(lastAssistant.content) ? lastAssistant.content : [lastAssistant.content];
        const textParts = contentArray
          .filter((c: Record<string, unknown>) => c.type === 'text' && typeof c.text === 'string')
          .map((c: Record<string, unknown>) => c.text as string);
        if (textParts.length > 0) {
          const finalData = { type: 'item', itemType: 'agent_message', itemId: session.lastMessageId, status: 'completed', message: { role: 'assistant', content: textParts.join('') } };
          session.writer?.send(toProviderRuntimeResponseEvent({ provider: 'pi', data: finalData, sessionId: piSession.sessionId }));
          recordProviderLiveTranscriptEvent('pi', piSession.sessionId, session.projectPath, finalData);
        }
      }
      completeProviderLiveTranscriptSnapshot('pi', piSession.sessionId, session.projectPath);
      session.writer?.send(toProviderRuntimeCompleteEvent({ provider: 'pi', sessionId: piSession.sessionId, actualSessionId: piSession.sessionId }));
      session.status = 'completed';
      session.turnStartedAt = null;
      return;
    }

    // Turn completed: forward tool results and turn_complete
    if (ev.type === 'turn_end') {
      getPiStreamingDeltaBatcher(session).flushSession(piSession.sessionId);
      session.writer?.send(toProviderRuntimeResponseEvent({ provider: 'pi', data: transformPiEvent(ev), sessionId: piSession.sessionId }));
      return;
    }

    // Streaming agent message delta: forward to frontend
    if (ev.type === 'message_update') {
      const transformed = transformPiEvent(ev);
      const t = transformed as Record<string, unknown>;
      if (t.itemId && (t.itemType === 'agent_message' || t.itemType === 'reasoning')) {
        session.lastMessageId = String(t.itemId);
      }
      if (isStreamingTextItem(t)) {
        getPiStreamingDeltaBatcher(session).enqueue({
          envelopeType: 'pi-response',
          sessionId: piSession.sessionId,
          itemType: t.itemType as 'agent_message' | 'reasoning',
          itemId: t.itemId ?? null,
          text: getStreamingDeltaText(t),
        });
        return;
      }
      session.writer?.send(toProviderRuntimeResponseEvent({ provider: 'pi', data: transformed, sessionId: piSession.sessionId }));
      recordProviderLiveTranscriptEvent('pi', piSession.sessionId, session.projectPath, t);
      return;
    }

    // Tool execution events: forward to frontend
    if (ev.type === 'tool_execution_start' || ev.type === 'tool_execution_update' || ev.type === 'tool_execution_end') {
      const transformed = transformPiEvent(ev);
      session.writer?.send(toProviderRuntimeResponseEvent({ provider: 'pi', data: transformed, sessionId: piSession.sessionId }));
      recordProviderLiveTranscriptEvent('pi', piSession.sessionId, session.projectPath, transformed as Record<string, unknown>);
      return;
    }

    // Turn started
    if (ev.type === 'turn_start') {
      const timestamp = typeof ev.timestamp === 'number' ? ev.timestamp : Date.now();
      if (!session.turnStartedAt) {
        session.turnStartedAt = new Date(timestamp).toISOString();
      }
      session.writer?.send(toProviderRuntimeResponseEvent({ provider: 'pi', data: transformPiEvent(ev), sessionId: piSession.sessionId }));
      return;
    }

    if (ev.type === 'error') {
      getPiStreamingDeltaBatcher(session).flushSession(piSession.sessionId);
      session.writer?.send(toProviderRuntimeErrorEvent({ provider: 'pi', error: ev.message || 'Pi error', sessionId: piSession.sessionId }));
      session.status = 'failed';
      session.turnStartedAt = null;
      discardProviderLiveTranscriptSnapshot('pi', piSession.sessionId, session.projectPath);
      return;
    }
  });
}

async function runPiTurn(session: PiSessionRecord, text: string, runningBehavior: RunningBehavior | undefined, options: {
  model?: string;
  thinkingLevel?: string;
  permissionMode?: string;
  sessionId?: string;
  clientRequestId?: string | null;
}): Promise<void> {
  await ensurePiSession(session, options);
  const piSession = session.session!;
  const wasRunning = (session.status as string) === 'running';
  session.status = 'running';
  if (!wasRunning || !session.turnStartedAt) {
    session.turnStartedAt = new Date().toISOString();
  }

  if (session.writer) {
    session.writer.send(toProviderSessionCreatedEvent({
      provider: 'pi',
      sessionId: piSession.sessionId,
      clientRequestId: options.clientRequestId || null,
    }));
    if (typeof session.writer.setSessionId === 'function') {
      session.writer.setSessionId(piSession.sessionId);
    }
    session.writer.send(toProviderSessionStatusEvent({
      provider: 'pi',
      sessionId: piSession.sessionId,
      isProcessing: true,
      turnId: piSession.sessionId,
      turnStartedAt: session.turnStartedAt || undefined,
    }));
  }

  // Fire message-accepted via preflightResult before prompt() resolves.
  // prompt() may block for minutes until the full agent run completes;
  // without early acceptance the frontend marks the optimistic user message
  // as failed after 30s (useChatComposerState.ts:263-285).
  // preflightResult(false) means the prompt was rejected before acceptance.
  const promptOptions: Record<string, unknown> = {};
  if (runningBehavior === 'steer') {
    promptOptions.streamingBehavior = 'steer';
  } else if (runningBehavior === 'followUp') {
    promptOptions.streamingBehavior = 'followUp';
  }
  promptOptions.preflightResult = (success: boolean) => {
    if (!session.writer) return;
    if (success) {
      session.writer.send(toProviderMessageAcceptedEvent({
        provider: 'pi',
        sessionId: piSession.sessionId,
        clientRequestId: options.clientRequestId || null,
      }));
    } else {
      // Preflight rejected: reset running state so the frontend doesn't
      // stay stuck with isProcessing=true and canAbortSession active.
      session.status = 'failed';
      session.turnStartedAt = null;
      discardProviderLiveTranscriptSnapshot('pi', piSession.sessionId, session.projectPath);
      session.writer.send(toProviderMessageRejectedEvent({
        provider: 'pi',
        sessionId: piSession.sessionId,
        reason: 'preflight-rejected',
        clientRequestId: options.clientRequestId || null,
      }));
      session.writer.send(toProviderSessionStatusEvent({
        provider: 'pi',
        sessionId: piSession.sessionId,
        isProcessing: false,
        turnId: piSession.sessionId,
      }));
    }
  };

  // Fire-and-forget the prompt; errors surface through pi-error events.
  void piSession.prompt(text, promptOptions).catch((error: unknown) => {
    if ((session.status as string) === 'aborted') return;
    session.status = 'failed';
    session.turnStartedAt = null;
    const err = error as { message?: string };
    discardProviderLiveTranscriptSnapshot('pi', piSession.sessionId, session.projectPath);
    session.writer?.send(toProviderRuntimeErrorEvent({ provider: 'pi', error: err?.message || 'Pi error', sessionId: piSession.sessionId }));
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sendNativeMessage(input: {
  provider: Provider;
  sessionId: string;
  projectPath: string;
  text: string;
  runningBehavior?: RunningBehavior;
  model?: string;
  thinkingLevel?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  clientRequestId?: string | null;
  turnAnchorKey?: string | null;
  writer?: RuntimeWriter | null;
  providerSessionId?: string;
}): Promise<{ accepted: boolean; queued?: boolean; providerSessionId?: string }> {
  const { provider, sessionId, projectPath, text, runningBehavior, writer, clientRequestId } = input;
  const resolvedProjectPath = projectPath || process.cwd();
  const overlayWriter = withActiveTurnOverlayWriter(writer || null, provider, sessionId, resolvedProjectPath);
  recordProviderActiveTurnUser({
    provider,
    sessionId,
    projectPath: resolvedProjectPath,
    clientRequestId: clientRequestId || '',
    turnAnchorKey: input.turnAnchorKey || '',
    userText: text,
  });

  if (provider === 'codex') {
    const result = await sendCodexAppServerMessage({
      ozwSessionId: sessionId,
      projectPath: resolvedProjectPath,
      text,
      runningBehavior,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      permissionMode: input.permissionMode,
      clientRequestId,
      writer: overlayWriter,
      providerSessionId: input.providerSessionId,
    });

    // Synchronize local session shadow for test harness compatibility
    const session = getOrCreateCodexSession(sessionId, resolvedProjectPath, overlayWriter);
    const codexStatus = getCodexAppServerSessionStatus(sessionId, resolvedProjectPath);
    session.providerThreadId = codexStatus.providerSessionId || null;
    session.activeTurnId = codexStatus.turnId || null;
    session.turnStartedAt = codexStatus.turnStartedAt || null;
    if (codexStatus.isProcessing) {
      session.status = 'running';
    }

    return result;
  }

  if (provider === 'pi') {
    const session = getOrCreatePiSession(sessionId, resolvedProjectPath, overlayWriter);
    const isRunningBeforePrompt = (session.status as string) === 'running';
    const effectiveRunningBehavior = isRunningBeforePrompt ? (runningBehavior || 'steer') : undefined;

    if (shouldUseFakePiRuntime()) {
      return runFakePiTurn(session, text, effectiveRunningBehavior, { clientRequestId });
    }

    // Must await session init before returning accepted — if
    // createAgentSession / SessionManager.open fails we must send
    // pi-error and NOT confirm the request.
    try {
      await ensurePiSession(session, {
        model: input.model,
        thinkingLevel: input.thinkingLevel,
        permissionMode: input.permissionMode,
        sessionId: input.providerSessionId || sessionId,
        clientRequestId,
      });
    } catch (error: unknown) {
      session.status = 'failed';
      const err = error as { message?: string };
      session.writer?.send(toProviderRuntimeErrorEvent({ provider: 'pi', error: err?.message || 'Pi session init failed', sessionId }));
      return { accepted: false };
    }

    // Session is ready — fire prompt in background.  runPiTurn sends
    // message-accepted via preflightResult(true) before prompt blocks,
    // and message-rejected via preflightResult(false) when preflight fails.
    // Prompt errors surface through pi-error events.
    void runPiTurn(session, text, effectiveRunningBehavior, {
      model: input.model,
      thinkingLevel: input.thinkingLevel,
      permissionMode: input.permissionMode,
      sessionId,
      clientRequestId,
    });
    return { accepted: true, providerSessionId: session.session?.sessionId || sessionId };
  }

  return { accepted: false };
}

export const sendProviderRuntimeMessage = sendNativeMessage;

export async function abortNativeSession(provider: Provider, sessionId: string, projectPath = ''): Promise<{ aborted: boolean }> {
  if (provider === 'codex') {
    const aborted = await abortCodexAppServerSession(sessionId, projectPath || process.cwd());
    if (aborted) {
      const session = findRuntimeSession('codex', sessionId, projectPath) as CodexSessionRecord | undefined;
      if (session) {
        session.status = 'aborted';
        session.activeTurnId = null;
        session.turnStartedAt = null;
      }
    }
    return { aborted };
  }

  if (provider === 'pi') {
    const session = findRuntimeSession('pi', sessionId, projectPath) as PiSessionRecord | undefined;
    if (!session) {
      return { aborted: false };
    }
    if (!session.session && shouldUseFakePiRuntime()) {
      const wasRunning = session.status === 'running';
      session.status = 'aborted';
      session.turnStartedAt = null;
      const providerSessionId = session.fakeProviderSessionId || session.ozwSessionId;
      discardProviderLiveTranscriptSnapshot('pi', providerSessionId, session.projectPath);
      session.writer?.send(toProviderSessionAbortedEvent({
        provider: 'pi',
        sessionId: providerSessionId,
        success: wasRunning,
      }));
      return { aborted: wasRunning };
    }
    if (!session.session) {
      return { aborted: false };
    }
    getPiStreamingDeltaBatcher(session).flushSession(session.session.sessionId);
    await session.session.abort();
    session.status = 'aborted';
    session.turnStartedAt = null;
    discardProviderLiveTranscriptSnapshot('pi', session.session.sessionId, session.projectPath);
    session.writer?.send(toProviderSessionAbortedEvent({
      provider: 'pi',
      sessionId: session.session.sessionId,
      success: true,
    }));
    return { aborted: true };
  }

  return { aborted: false };
}

export function getNativeSessionStatus(provider: Provider, sessionId: string, projectPath = ''): { isProcessing: boolean; providerSessionId?: string; turnId?: string; turnStartedAt?: string } {
  const session = findRuntimeSession(provider, sessionId, projectPath);
  if (!session) return { isProcessing: false };
  if (provider === 'codex') {
    return getCodexAppServerSessionStatus(sessionId, projectPath || process.cwd());
  }
  const piSession = session as PiSessionRecord;
  return {
    isProcessing: piSession.status === 'running',
    providerSessionId: piSession.session?.sessionId || sessionId,
    turnId: piSession.session?.sessionId || undefined,
    turnStartedAt: piSession.status === 'running' ? piSession.turnStartedAt || undefined : undefined,
  };
}

export function getActiveNativeSessions(): { codex: Array<Record<string, unknown>>; pi: Array<Record<string, unknown>> } {
  const codexSessions = getActiveCodexAppServerSessions();
  const piTurns: Array<Record<string, unknown>> = [];
  for (const [id, session] of sessions.entries()) {
    if ((session.status as string) !== 'running') continue;
    if (session.provider === 'pi') {
      piTurns.push({
        id: (session as PiSessionRecord).session?.sessionId || id,
        turnId: id,
        status: session.status,
        startedAt: session.startedAt,
        projectPath: session.projectPath,
        ozwSessionId: session.ozwSessionId,
        provider: 'pi',
      });
    }
  }
  return {
    codex: codexSessions,
    pi: piTurns,
  };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

export type RuntimeHarness = {
  sendMessage(input: {
    provider: Provider;
    sessionId: string;
    projectPath: string;
    text: string;
    runningBehavior?: RunningBehavior;
  }): Promise<{ accepted: boolean; queued?: boolean; providerSessionId?: string }>;
  abortSession(input: { provider: Provider; sessionId: string }): Promise<{ aborted: boolean }>;
  releaseProvider(provider: Provider, label?: string): Promise<void>;
  readMessages(input: { provider: Provider; sessionId: string }): Promise<Array<{ role: string; content: string }>>;
  getAdapterEvents(provider: Provider): Array<{ type: string; text?: string; behavior?: string }>;
};

type FakeAdapterEvent = { type: string; text?: string; behavior?: string };

class FakeCodexAdapter {
  events: FakeAdapterEvent[] = [];
  private turnResolvers: Array<() => void> = [];
  labels: string[] = [];
  private pendingTurns: Array<{ label: string; ozwSessionId: string }> = [];

  pushEvent(event: FakeAdapterEvent) {
    this.events.push(event);
  }

  resolveTurn(label: string) {
    this.labels.push(label);
    const resolver = this.turnResolvers.shift();
    if (resolver) {
      resolver();
    } else {
      // No waiter yet – record for future resolution
      this.pendingTurns.push({ label, ozwSessionId: '' });
    }
  }

  /** Register that a turn is now in-flight. Returns a promise resolved by resolveTurn. */
  startTurn(): Promise<void> {
    // Drain any pre-resolved turns first
    const pending = this.pendingTurns.shift();
    if (pending) {
      this.labels.push(pending.label);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.turnResolvers.push(resolve);
    });
  }
}

class FakePiAdapter {
  events: FakeAdapterEvent[] = [];
  private turnResolvers: Array<() => void> = [];
  labels: string[] = [];
  private pendingTurns: Array<{ label: string }> = [];

  pushEvent(event: FakeAdapterEvent) {
    this.events.push(event);
  }

  resolveTurn(label: string) {
    this.labels.push(label);
    const resolver = this.turnResolvers.shift();
    if (resolver) {
      resolver();
    } else {
      this.pendingTurns.push({ label });
    }
  }

  startTurn(): Promise<void> {
    const pending = this.pendingTurns.shift();
    if (pending) {
      this.labels.push(pending.label);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.turnResolvers.push(resolve);
    });
  }
}

/**
 * Create a test harness that injects fake adapters so acceptance tests can
 * verify business semantics without calling real SDKs.
 *
 * Each call returns independent adapter instances so tests do not share event state.
 */
export function createNativeAgentRuntimeForTest(): RuntimeHarness {
  const codexAdapter = new FakeCodexAdapter();
  const piAdapter = new FakePiAdapter();

  return {
    async sendMessage({ provider, sessionId, projectPath, text, runningBehavior }) {
      if (provider === 'codex') {
        const session = getOrCreateCodexSession(sessionId, projectPath || process.cwd(), null);
        if ((session.status as string) === 'running' && runningBehavior === 'steer') {
          if (!session.activeTurnId) {
            return { accepted: false };
          }
          codexAdapter.pushEvent({ type: 'steer', text, behavior: runningBehavior });
          return { accepted: true };
        }
        codexAdapter.pushEvent({ type: 'send', text, behavior: runningBehavior });
        if ((session.status as string) === 'running' && runningBehavior === 'abort-and-send') {
          session.status = 'aborted';
          session.activeTurnId = null;
          codexAdapter.pushEvent({ type: 'abort' });
        }
        session.status = 'running';
        session.activeTurnId = `turn-${Date.now()}`;
        session.turnStartedAt = new Date().toISOString();
        // Start turn asynchronously; releaseProvider resolves it
        codexAdapter.startTurn().then(() => {
          session.status = 'completed';
          session.activeTurnId = null;
          session.turnStartedAt = null;
        });
        return { accepted: true, providerSessionId: `codex-${sessionId}` };
      }

      if (provider === 'pi') {
        piAdapter.pushEvent({ type: 'queue', text, behavior: runningBehavior });
        const session = getOrCreatePiSession(sessionId, projectPath || process.cwd(), null);
        session.status = 'running';
        session.turnStartedAt = new Date().toISOString();
        piAdapter.startTurn().then(() => {
          session.status = 'completed';
          session.turnStartedAt = null;
        });
        return { accepted: true, providerSessionId: `pi-${sessionId}` };
      }

      return { accepted: false };
    },

    async abortSession({ provider, sessionId }) {
      if (provider === 'codex') {
        const session = findRuntimeSession('codex', sessionId) as CodexSessionRecord | undefined;
        if (!session || (session.status as string) !== 'running') return { aborted: false };
        session.status = 'aborted';
        session.activeTurnId = null;
        session.turnStartedAt = null;
        codexAdapter.pushEvent({ type: 'abort' });
        return { aborted: true };
      }
      if (provider === 'pi') {
        const session = findRuntimeSession('pi', sessionId) as PiSessionRecord | undefined;
        if (!session || (session.status as string) !== 'running') return { aborted: false };
        session.status = 'aborted';
        session.turnStartedAt = null;
        piAdapter.pushEvent({ type: 'abort' });
        return { aborted: true };
      }
      return { aborted: false };
    },

    async releaseProvider(provider, label) {
      if (provider === 'codex') {
        codexAdapter.resolveTurn(label || 'done');
      } else {
        piAdapter.resolveTurn(label || 'done');
      }
    },

    async readMessages({ provider, sessionId }) {
      if (provider === 'codex') {
        const allEvents = codexAdapter.events;
        // Skip send events that were aborted (before the last abort marker)
        let lastAbortIndex = -1;
        for (let i = allEvents.length - 1; i >= 0; i -= 1) {
          if (allEvents[i].type === 'abort') {
            lastAbortIndex = i;
            break;
          }
        }
        const sends = allEvents
          .slice(lastAbortIndex + 1)
          .filter((e) => e.type === 'send' || e.type === 'steer');
        const msgs: Array<{ role: string; content: string }> = [];
        const labels = codexAdapter.labels;
        let labelIndex = 0;
        for (const ev of sends) {
          msgs.push({ role: 'user', content: ev.text || '' });
          if (labelIndex < labels.length) {
            msgs.push({ role: 'assistant', content: labels[labelIndex] });
            labelIndex += 1;
          }
        }
        return msgs;
      }
      if (provider === 'pi') {
        const allEvents = piAdapter.events;
        let lastAbortIndex = -1;
        for (let i = allEvents.length - 1; i >= 0; i -= 1) {
          if (allEvents[i].type === 'abort') {
            lastAbortIndex = i;
            break;
          }
        }
        const sends = allEvents
          .slice(lastAbortIndex + 1)
          .filter((e) => e.type === 'queue');
        const msgs: Array<{ role: string; content: string }> = [];
        const labels = piAdapter.labels;
        let labelIndex = 0;
        for (const ev of sends) {
          msgs.push({ role: 'user', content: ev.text || '' });
          if (labelIndex < labels.length) {
            msgs.push({ role: 'assistant', content: labels[labelIndex] });
            labelIndex += 1;
          }
        }
        return msgs;
      }
      return [];
    },

    getAdapterEvents(provider) {
      return provider === 'codex' ? [...codexAdapter.events] : [...piAdapter.events];
    },
  };
}
