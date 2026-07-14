/**
 * 文件目的：组合 Codex app-server transport、session manager 和 notification reducer。
 * 业务意义：后端手动 Codex 会话通过此 facade 发送新 turn、steer、abort，并允许测试注入 transport 覆盖实时路径。
 */

import { CODEX_APPROVAL_POLICY, CODEX_SANDBOX_MODE } from '../../constants/config.js';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  normalizeCodexApprovalPolicy,
  normalizeCodexSandboxMode,
  resolveCodexPermissionPolicy,
} from '../../codex-permission-policy.js';
import {
  CodexAppServerSessionManager,
  type CodexAppServerSession,
} from './session-manager.js';
import {
  buildCodexAppServerCliArgs,
  createStdioAppServerTransport,
  type CodexAppServerNotification,
  type CodexAppServerTransport,
} from './stdio-transport.js';
import {
  handleAppServerNotification,
  transformAppServerItem,
} from './notification-reducer.js';
import type { RuntimeWriter } from './types.js';

export type { CodexAppServerTransport };
export { handleAppServerNotification, transformAppServerItem };

type CodexRuntimePolicy = {
  sandbox: string;
  approvalPolicy: string;
};

const CODEX_MULTI_AGENT_MODE = 'proactive';

type RuntimeDependencies = {
  sessionManager: CodexAppServerSessionManager;
  getTransport: () => CodexAppServerTransport;
  resetTransport: () => void;
};

const productionSessionManager = new CodexAppServerSessionManager();
let sharedTransport: CodexAppServerTransport | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const threadInitializationByRoute = new Map<string, Promise<{ providerSessionId: string }>>();
let remoteTuiCaptureQueue: Promise<void> = Promise.resolve();

const productionDependencies: RuntimeDependencies = {
  sessionManager: productionSessionManager,
  getTransport: getOrCreateAppServerClient,
  resetTransport: () => {
    sharedTransport = null;
  },
};

/**
 * 构建或复用生产 app-server transport。
 */
function getOrCreateAppServerClient(): CodexAppServerTransport {
  if (!sharedTransport) {
    sharedTransport = createStdioAppServerTransport({
      onFailure: (message) => {
        productionSessionManager.markTransportDisconnected(message);
        sharedTransport = null;
        scheduleSharedTransportReconnect();
      },
    });
  }
  return sharedTransport;
}

/** proxy 断开后渐进重连 daemon，并恢复所有现存 thread 的通知订阅。 */
function scheduleSharedTransportReconnect(): void {
  if (reconnectTimer) return;
  const delayMs = Math.min(1000 * (2 ** reconnectAttempt), 15000);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      const transport = getOrCreateAppServerClient();
      for (const session of productionSessionManager.getSessions()) {
        subscribeSessionNotifications(session, transport);
      }
      await transport.request('thread/list', { limit: 1 });
      reconnectAttempt = 0;
    } catch (err) {
      reconnectAttempt += 1;
      console.warn('[codex-app-server] proxy reconnect failed', err instanceof Error ? err.message : String(err));
      scheduleSharedTransportReconnect();
    }
  }, delayMs);
  reconnectTimer.unref?.();
}

/**
 * 将 UI 权限意图映射为 app-server thread/start 所需安全参数。
 */
function resolveCodexRuntimePolicy(permissionMode: string, highPermissionApproved = false): CodexRuntimePolicy {
  const policy = resolveCodexPermissionPolicy({ permissionMode, highPermissionApproved });
  return {
    sandbox: policy.sandboxMode,
    approvalPolicy: policy.approvalPolicy,
  };
}

/**
 * 构造 app-server turn input。
 */
function buildUserInput(text: string) {
  return [{ type: 'text', text, text_elements: [] }];
}

/**
 * 给指定 session 订阅一次 transport notification，并过滤其他 thread 的广播。
 */
function subscribeSessionNotifications(
  session: CodexAppServerSession,
  transport: CodexAppServerTransport,
): void {
  if (session.notificationSubscribed) return;
  session.notificationSubscribed = true;
  transport.onNotification((notification: CodexAppServerNotification) => {
    const p = (notification.params || {}) as Record<string, unknown>;
    const threadId = p.threadId || (p.thread as Record<string, unknown> | undefined)?.id;
    if (threadId && String(threadId) !== session.providerThreadId) {
      return;
    }
    handleAppServerNotification(session, notification, session.providerThreadId);
  });
}

/**
 * 为一个新建远端 TUI 串行预留 thread/started 事件，并按工作目录确认归属。
 */
export async function beginCodexRemoteTuiThreadCapture(input: {
  projectPath: string;
  timeoutMs?: number;
}, injectedTransport?: CodexAppServerTransport): Promise<{
  endpoint: string;
  threadStarted: Promise<{ providerSessionId: string }>;
}> {
  let releaseQueue!: () => void;
  const previousCapture = remoteTuiCaptureQueue;
  remoteTuiCaptureQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previousCapture;

  let transport: CodexAppServerTransport;
  try {
    transport = injectedTransport || productionDependencies.getTransport();
  } catch (error) {
    releaseQueue();
    throw error;
  }
  let settled = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const baselineThreadIds = new Set<string>();
  let resolveThread!: (value: { providerSessionId: string }) => void;
  let rejectThread!: (error: Error) => void;
  const threadStarted = new Promise<{ providerSessionId: string }>((resolve, reject) => {
    resolveThread = resolve;
    rejectThread = reject;
  });
  const finish = (value: { providerSessionId: string } | Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (pollTimer) clearTimeout(pollTimer);
    releaseQueue();
    if (value instanceof Error) rejectThread(value);
    else resolveThread(value);
  };
  const timeout = setTimeout(() => {
    finish(new Error('Timed out waiting for Codex remote TUI thread creation'));
  }, input.timeoutMs || 20_000);
  timeout.unref?.();

  transport.onNotification((notification: CodexAppServerNotification) => {
    if (settled || notification.method !== 'thread/started') return;
    const thread = ((notification.params || {}) as Record<string, any>).thread;
    const threadId = typeof thread?.id === 'string' ? thread.id : '';
    const threadCwd = typeof thread?.cwd === 'string' ? path.resolve(thread.cwd) : '';
    if (!threadId || threadCwd !== path.resolve(input.projectPath)) return;
    finish({ providerSessionId: threadId });
  });

  try {
    const loaded = await transport.request('thread/loaded/list', {}) as { data?: unknown[] };
    for (const threadId of loaded?.data || []) {
      if (typeof threadId === 'string') baselineThreadIds.add(threadId);
    }
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
    await threadStarted;
  }
  /** 远端 TUI 属于独立客户端；daemon 可能不广播其创建事件，因此用 loaded 集合精确取差集。 */
  const pollLoadedThreads = async (): Promise<void> => {
    if (settled) return;
    try {
      const loaded = await transport.request('thread/loaded/list', {}) as { data?: unknown[] };
      for (const value of loaded?.data || []) {
        const threadId = typeof value === 'string' ? value : '';
        if (!threadId || baselineThreadIds.has(threadId)) continue;
        const result = await transport.request('thread/read', { threadId, includeTurns: false }) as Record<string, any>;
        const threadCwd = typeof result?.thread?.cwd === 'string' ? path.resolve(result.thread.cwd) : '';
        if (threadCwd === path.resolve(input.projectPath)) {
          finish({ providerSessionId: threadId });
          return;
        }
      }
    } catch {
      // 新终端启动期间允许短暂读取失败，超时会释放队列并给出明确错误。
    }
    if (!settled) {
      pollTimer = setTimeout(() => void pollLoadedThreads(), 200);
      pollTimer.unref?.();
    }
  };
  void pollLoadedThreads();
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  return {
    endpoint: `unix://${path.join(codexHome, 'app-server-control', 'app-server-control.sock')}`,
    threadStarted,
  };
}

/**
 * 创建或恢复一个由共享 app-server 承载的线程，并按 cN 路由串行化初始化。
 */
export async function ensureCodexAppServerThread(input: {
  ozwSessionId: string;
  projectPath: string;
  model?: string;
  serviceTier?: string;
  permissionMode?: string;
  writer?: RuntimeWriter | null;
  providerSessionId?: string;
  highPermissionApproved?: boolean;
}, injectedTransport?: CodexAppServerTransport): Promise<{ providerSessionId: string }> {
  const routeKey = `${input.projectPath}\u0000${input.ozwSessionId}`;
  const pending = threadInitializationByRoute.get(routeKey);
  if (pending) return pending;

  const initialization = (async () => {
    const session = productionSessionManager.getOrCreateSession(input.ozwSessionId, input.projectPath, input.writer || null);
    const transport = injectedTransport || productionDependencies.getTransport();
    const hasRealProviderId = Boolean(input.providerSessionId && !/^c\d+$/.test(input.providerSessionId));

    if (hasRealProviderId && input.providerSessionId !== session.providerThreadId) {
      await transport.request('thread/resume', { threadId: input.providerSessionId });
      session.providerThreadId = String(input.providerSessionId);
    } else if (!session.providerThreadId) {
      const { sandbox, approvalPolicy } = resolveCodexRuntimePolicy(input.permissionMode || 'default', input.highPermissionApproved === true);
      const threadResult = await transport.request('thread/start', {
        model: input.model || null,
        serviceTier: input.serviceTier || null,
        cwd: input.projectPath || null,
        sandbox,
        approvalPolicy,
        multiAgentMode: CODEX_MULTI_AGENT_MODE,
      });
      const thread = (threadResult as Record<string, any>)?.thread;
      if (thread?.id) {
        session.providerThreadId = String(thread.id);
        session.writer?.send({ type: 'session-created', sessionId: session.providerThreadId, provider: 'codex' });
        if (typeof session.writer?.setSessionId === 'function') {
          session.writer.setSessionId(session.providerThreadId);
        }
      }
    }

    if (!session.providerThreadId) {
      throw new Error('Failed to start or resume Codex thread');
    }
    subscribeSessionNotifications(session, transport);
    return { providerSessionId: session.providerThreadId };
  })().finally(() => {
    threadInitializationByRoute.delete(routeKey);
  });
  threadInitializationByRoute.set(routeKey, initialization);
  return initialization;
}

/**
 * 向 Codex app-server 发送用户输入，runningBehavior=steer 时写入当前 active turn。
 */
export async function sendCodexAppServerMessage(input: {
  ozwSessionId: string;
  projectPath: string;
  text: string;
  runningBehavior?: string;
  model?: string;
  serviceTier?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  clientRequestId?: string | null;
  writer?: RuntimeWriter | null;
  providerSessionId?: string;
  highPermissionApproved?: boolean;
}, injectedTransport?: CodexAppServerTransport): Promise<{ accepted: boolean; providerSessionId?: string }> {
  const session = productionSessionManager.getOrCreateSession(input.ozwSessionId, input.projectPath, input.writer || null);
  const transport = injectedTransport || productionDependencies.getTransport();
  const ensuredThread = await ensureCodexAppServerThread(input, transport);

  if (input.runningBehavior === 'steer') {
    if (!session.activeTurnId) {
      input.writer?.send({
        type: 'steer-rejected',
        sessionId: session.providerThreadId,
        provider: 'codex',
        clientRequestId: input.clientRequestId || null,
        error: 'No active turn to steer',
      });
      return { accepted: false };
    }

    await transport.request('turn/steer', {
      threadId: session.providerThreadId,
      expectedTurnId: session.activeTurnId,
      input: buildUserInput(input.text),
    });
    input.writer?.send({ type: 'message-accepted', sessionId: session.providerThreadId, provider: 'codex', clientRequestId: input.clientRequestId || null });
    return { accepted: true, providerSessionId: ensuredThread.providerSessionId };
  }

  if (input.runningBehavior === 'abort-and-send') {
    if (session.activeTurnId) {
      try {
        await transport.request('turn/interrupt', { threadId: session.providerThreadId, turnId: session.activeTurnId });
      } catch (err) {
        input.writer?.send({
          type: 'codex-error',
          error: `Failed to interrupt active turn: ${err instanceof Error ? err.message : String(err)}`,
          sessionId: session.providerThreadId,
        });
        return { accepted: false };
      }
    }
    session.activeTurnId = null;
    session.turnStartedAt = null;
    session.status = 'aborted';
  }

  const turnResult = await transport.request('turn/start', {
    threadId: session.providerThreadId,
    input: buildUserInput(input.text),
    model: input.model || null,
    serviceTier: input.serviceTier || null,
    effort: input.reasoningEffort || null,
    multiAgentMode: CODEX_MULTI_AGENT_MODE,
  });
  const turn = (turnResult as Record<string, any>)?.turn;
  if (turn?.id) {
    session.activeTurnId = String(turn.id);
    session.turnStartedAt = new Date().toISOString();
    session.status = 'running';
  }
  input.writer?.send({ type: 'message-accepted', sessionId: session.providerThreadId, provider: 'codex', clientRequestId: input.clientRequestId || null });
  return { accepted: true, providerSessionId: ensuredThread.providerSessionId };
}

export const __codexAppServerRuntimeInternalsForTest = {
  buildCodexAppServerCliArgs,
  normalizeCodexApprovalPolicy,
  normalizeCodexSandboxMode,
  resolveCodexRuntimePolicy,
};

/**
 * 中断指定 Codex app-server session 的当前 active turn。
 */
export async function abortCodexAppServerSession(ozwSessionId: string, projectPath: string, injectedTransport?: CodexAppServerTransport): Promise<boolean> {
  const session = productionSessionManager.getSession(ozwSessionId, projectPath);
  if (!session || !session.providerThreadId) return false;

  const transport = injectedTransport || productionDependencies.getTransport();
  try {
    if (session.activeTurnId) {
      await transport.request('turn/interrupt', { threadId: session.providerThreadId, turnId: session.activeTurnId });
    }
  } catch (err) {
    session.writer?.send({
      type: 'codex-error',
      error: `Failed to interrupt active turn: ${err instanceof Error ? err.message : String(err)}`,
      sessionId: session.providerThreadId,
    });
    return false;
  }

  session.status = 'aborted';
  session.activeTurnId = null;
  session.turnStartedAt = null;
  session.streamingDeltaBatcher?.flushSession(session.providerThreadId || session.ozwSessionId);
  session.writer?.send({ type: 'session-aborted', sessionId: session.providerThreadId, provider: 'codex', success: true });
  return true;
}

/**
 * 查询指定 Codex app-server session 当前处理状态。
 */
export function getCodexAppServerSessionStatus(ozwSessionId: string, projectPath: string): {
  isProcessing: boolean;
  providerSessionId?: string;
  turnId?: string;
  turnStartedAt?: string;
} {
  const session = productionSessionManager.getSession(ozwSessionId, projectPath);
  if (!session) return { isProcessing: false };
  return {
    isProcessing: session.status === 'running',
    providerSessionId: session.providerThreadId || undefined,
    turnId: session.activeTurnId || undefined,
    turnStartedAt: session.status === 'running' ? session.turnStartedAt || undefined : undefined,
  };
}

/**
 * 清理测试会话和共享 transport。
 */
export function clearCodexAppServerSessionsForTest(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
  productionSessionManager.clear();
  threadInitializationByRoute.clear();
  remoteTuiCaptureQueue = Promise.resolve();
  productionDependencies.resetTransport();
}

/**
 * 返回当前 active Codex app-server sessions。
 */
export function getActiveCodexAppServerSessions(): Array<Record<string, unknown>> {
  return productionSessionManager.getActiveSessions();
}

/**
 * 创建注入 transport 的轻量测试 runtime。
 */
export function createCodexAppServerRuntimeForTest(options: {
  transport: CodexAppServerTransport;
  writer: RuntimeWriter;
  projectPath: string;
}) {
  const { transport, writer, projectPath } = options;
  const sessionManager = new CodexAppServerSessionManager();

  return {
    async sendMessage(input: {
      ozwSessionId: string;
      text: string;
      runningBehavior?: string;
      model?: string;
      reasoningEffort?: string;
      permissionMode?: string;
      clientRequestId?: string;
    }) {
      const session = sessionManager.getOrCreateSession(input.ozwSessionId, projectPath, writer);

      if (!session.providerThreadId) {
        const threadResult = await transport.request('thread/start', {
          model: input.model,
          cwd: projectPath,
          multiAgentMode: CODEX_MULTI_AGENT_MODE,
        });
        session.providerThreadId = ((threadResult as Record<string, any>)?.thread?.id) || null;
        subscribeSessionNotifications(session, transport);
        const turnResult = await transport.request('turn/start', {
          threadId: session.providerThreadId,
          input: buildUserInput(input.text),
          multiAgentMode: CODEX_MULTI_AGENT_MODE,
        });
        const turnId = (turnResult as Record<string, any>)?.turn?.id;
        if (turnId) {
          session.activeTurnId = turnId;
          session.turnStartedAt = new Date().toISOString();
          session.status = 'running';
        }
        writer.send({ type: 'message-accepted', clientRequestId: input.clientRequestId });
        return;
      }

      if (input.runningBehavior === 'steer') {
        if (!session.activeTurnId) {
          writer.send({ type: 'steer-rejected', clientRequestId: input.clientRequestId, error: 'Cannot steer: no active turn' });
          return;
        }
        await transport.request('turn/steer', { threadId: session.providerThreadId, expectedTurnId: session.activeTurnId, input: buildUserInput(input.text) });
        writer.send({ type: 'message-accepted', clientRequestId: input.clientRequestId });
        return;
      }

      const turnResult = await transport.request('turn/start', {
        threadId: session.providerThreadId,
        input: buildUserInput(input.text),
        multiAgentMode: CODEX_MULTI_AGENT_MODE,
      });
      const turnId = (turnResult as Record<string, any>)?.turn?.id;
      if (turnId) {
        session.activeTurnId = turnId;
        session.turnStartedAt = new Date().toISOString();
        session.status = 'running';
      }
      writer.send({ type: 'message-accepted', clientRequestId: input.clientRequestId });
    },

    __setSessionStateForTest(state: {
      ozwSessionId: string;
      providerThreadId: string;
      status: string;
      activeTurnId: string | null;
      turnStartedAt?: string | null;
    }) {
      const session = sessionManager.getOrCreateSession(state.ozwSessionId, projectPath, writer);
      session.providerThreadId = state.providerThreadId;
      session.status = state.status as any;
      session.activeTurnId = state.activeTurnId;
      session.turnStartedAt = state.turnStartedAt || null;
    },
  };
}
