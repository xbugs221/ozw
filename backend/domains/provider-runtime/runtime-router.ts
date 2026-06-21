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
import type { ChatMessageLike } from '../../../shared/provider-runtime-transcript.js';
import {
  sendCodexAppServerMessage,
  getCodexAppServerSessionStatus,
  getActiveCodexAppServerSessions,
} from '../../codex-app-server-runtime.js';
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
  toProviderMessageAcceptedEvent,
  toProviderMessageRejectedEvent,
  toProviderRuntimeCompleteEvent,
  toProviderRuntimeErrorEvent,
  toProviderRuntimeResponseEvent,
  toProviderSessionCreatedEvent,
  toProviderSessionQueueStateEvent,
  toProviderSessionStatusEvent,
} from './provider-runtime-events.js';
import { resolveCodexPermissionPolicy } from '../../codex-permission-policy.js';
import { transformPiEvent } from './provider-event-mappers.js';
type PiThinkingLevel = NonNullable<import('@earendil-works/pi-coding-agent').AgentSession['thinkingLevel']>;
import { runFakePiTurn, shouldUseFakePiRuntime } from './fake-pi-runtime.js';
import {
  abortNativeSession as abortStoredNativeSession,
  findRuntimeSession,
  getActivePiRuntimeSessions,
  getNativeSessionStatus as getStoredNativeSessionStatus,
  getOrCreateCodexSession,
  getOrCreatePiSession,
  getPiStreamingDeltaBatcher,
  type CodexSessionRecord,
  type PiSessionRecord,
  type RuntimeWriter,
} from './runtime-session-store.js';

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
export type { Provider, RuntimeEvent } from './provider-runtime-events.js';

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
  /**
   * Delegate abort state changes to runtime-session-store while preserving the
   * public runtime-router facade used by server bootstrap.
   */
  return abortStoredNativeSession(provider, sessionId, projectPath);
}

export function getNativeSessionStatus(provider: Provider, sessionId: string, projectPath = ''): { isProcessing: boolean; providerSessionId?: string; turnId?: string; turnStartedAt?: string } {
  /**
   * Delegate status lookup to runtime-session-store while preserving the public
   * runtime-router facade used by realtime dependencies.
   */
  return getStoredNativeSessionStatus(provider, sessionId, projectPath);
}

export function getActiveNativeSessions(): { codex: Array<Record<string, unknown>>; pi: Array<Record<string, unknown>> } {
  const codexSessions = getActiveCodexAppServerSessions();
  return {
    codex: codexSessions,
    pi: getActivePiRuntimeSessions(),
  };
}

export type { RuntimeHarness } from './provider-runtime-test-harness.js';
export type { RuntimeWriter } from './runtime-session-store.js';
export { createNativeAgentRuntimeForTest } from './provider-runtime-test-harness.js';
