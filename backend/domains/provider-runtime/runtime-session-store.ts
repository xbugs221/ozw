/**
 * 文件目的：集中管理 provider runtime session store 和状态查询边界。
 * 业务意义：send/status/abort 等 runtime facade 通过本模块共享 Codex/Pi 会话生命周期状态。
 */
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import {
  abortCodexAppServerSession,
  getCodexAppServerSessionStatus,
} from '../../codex-app-server-runtime.js';
import { StreamingDeltaBatcher } from '../../streaming-delta-batcher.js';
import { discardProviderLiveTranscriptSnapshot, recordProviderLiveTranscriptEvent } from './live-transcript-store.js';
import type { Provider } from './provider-runtime-events.js';
import { toProviderSessionAbortedEvent } from './provider-runtime-events.js';

export interface RuntimeWriter {
  send(data: unknown): void;
  setSessionId?(sessionId: string): void;
  setSessionIndexContext?(context: unknown): void;
}

export type CodexSessionRecord = {
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

export type PiSessionRecord = {
  provider: 'pi';
  ozwSessionId: string;
  status: 'running' | 'completed' | 'aborted' | 'failed';
  session: AgentSession | null;
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

export type SessionRecord = CodexSessionRecord | PiSessionRecord;

const sessions = new Map<string, SessionRecord>();

/**
 * Build the in-memory runtime key for one project-scoped cN route.
 */
export function getSessionId(provider: Provider, ozwSessionId: string, projectPath = ''): string {
  const normalizedProjectPath = String(projectPath || '').trim();
  return normalizedProjectPath
    ? `${provider}:${normalizedProjectPath}:${ozwSessionId}`
    : `${provider}:${ozwSessionId}`;
}

/**
 * Resolve a runtime session by exact project path, with a legacy fallback for status/abort requests.
 */
export function findRuntimeSession(provider: Provider, ozwSessionId: string, projectPath = ''): SessionRecord | undefined {
  const exact = sessions.get(getSessionId(provider, ozwSessionId, projectPath));
  if (exact) return exact;
  if (!projectPath) {
    for (const session of sessions.values()) {
      if (session.provider === provider && session.ozwSessionId === ozwSessionId) return session;
    }
  }
  return undefined;
}

/**
 * Return or create the local Codex session shadow used by runtime facade and tests.
 */
export function getOrCreateCodexSession(ozwSessionId: string, projectPath: string, writer: RuntimeWriter | null): CodexSessionRecord {
  const id = getSessionId('codex', ozwSessionId, projectPath);
  let session = sessions.get(id) as CodexSessionRecord | undefined;
  if (!session) {
    session = { provider: 'codex', ozwSessionId, status: 'completed', startedAt: new Date().toISOString(), projectPath, writer, providerThreadId: null, activeTurnId: null };
    sessions.set(id, session);
  }
  if (writer) session.writer = writer;
  return session;
}

/**
 * Return or create the local Pi session shadow used by runtime facade and tests.
 */
export function getOrCreatePiSession(ozwSessionId: string, projectPath: string, writer: RuntimeWriter | null): PiSessionRecord {
  const id = getSessionId('pi', ozwSessionId, projectPath);
  let session = sessions.get(id) as PiSessionRecord | undefined;
  if (!session) {
    session = { provider: 'pi', ozwSessionId, status: 'completed', session: null, startedAt: new Date().toISOString(), projectPath, writer, events: [], lastMessageId: null };
    sessions.set(id, session);
  }
  if (writer) session.writer = writer;
  return session;
}

/**
 * Return active local Pi sessions for browser status hydration.
 */
export function getActivePiRuntimeSessions(): Array<Record<string, unknown>> {
  const piTurns: Array<Record<string, unknown>> = [];
  for (const [id, session] of sessions.entries()) {
    if ((session.status as string) !== 'running' || session.provider !== 'pi') continue;
    piTurns.push({ id: session.session?.sessionId || id, turnId: id, status: session.status, startedAt: session.startedAt, projectPath: session.projectPath, ozwSessionId: session.ozwSessionId, provider: 'pi' });
  }
  return piTurns;
}

/**
 * Return the streaming delta batcher associated with one Pi runtime session.
 */
export function getPiStreamingDeltaBatcher(session: PiSessionRecord): StreamingDeltaBatcher {
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

/**
 * Abort one native runtime session and update the shared session store state.
 */
export async function abortNativeSession(provider: Provider, sessionId: string, projectPath = ''): Promise<{ aborted: boolean }> {
  /**
   * PURPOSE: Keep abort state transitions next to the runtime session records
   * instead of hiding them in the router facade.
   */
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

/**
 * Return runtime processing state for one native provider session.
 */
export function getNativeSessionStatus(provider: Provider, sessionId: string, projectPath = ''): { isProcessing: boolean; providerSessionId?: string; turnId?: string; turnStartedAt?: string } {
  /**
   * PURPOSE: Centralize session status lookup with the session store records so
   * router callers do not duplicate provider-specific state access.
   */
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

/**
 * 判断当前进程是否应使用 fake Pi runtime。
 */
function shouldUseFakePiRuntime(): boolean {
  /**
   * PURPOSE: Let abort handling mirror fake runtime behavior without importing
   * router facade code back into the session store.
   */
  return process.env.CCFLOW_FAKE_RUNNER === '1' || process.env.CBW_FAKE_PI_RUNTIME === '1';
}
