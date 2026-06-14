/**
 * 文件目的：管理 Codex app-server 会话状态和 transport 失败恢复。
 * 业务意义：running 会话失败、writer 绑定和 session 查询集中在此边界，便于用注入 transport 做回归测试。
 */

import { StreamingDeltaBatcher } from '../../streaming-delta-batcher.js';
import type { RuntimeWriter } from './types.js';

export type CodexAppServerSessionStatus = 'running' | 'completed' | 'aborted' | 'failed';

export type CodexAppServerSession = {
  ozwSessionId: string;
  providerThreadId: string | null;
  activeTurnId: string | null;
  turnStartedAt?: string | null;
  status: CodexAppServerSessionStatus;
  projectPath: string;
  writer: RuntimeWriter | null;
  liveMessages: unknown[];
  notificationSubscribed: boolean;
  streamingDeltaBatcher?: StreamingDeltaBatcher;
};

export class CodexAppServerSessionManager {
  private readonly sessions = new Map<string, CodexAppServerSession>();

  /**
   * 读取或创建指定 ozw session 和项目路径对应的 app-server session。
   */
  getOrCreateSession(ozwSessionId: string, projectPath: string, writer: RuntimeWriter | null): CodexAppServerSession {
    const id = this.getSessionId(ozwSessionId, projectPath);
    let session = this.sessions.get(id);
    if (!session) {
      session = {
        ozwSessionId,
        providerThreadId: null,
        activeTurnId: null,
        turnStartedAt: null,
        status: 'completed',
        projectPath,
        writer,
        liveMessages: [],
        notificationSubscribed: false,
      };
      this.sessions.set(id, session);
    }
    if (writer) session.writer = writer;
    return session;
  }

  /**
   * 按 ozw session 和项目路径读取已存在 session。
   */
  getSession(ozwSessionId: string, projectPath: string): CodexAppServerSession | undefined {
    return this.sessions.get(this.getSessionId(ozwSessionId, projectPath));
  }

  /**
   * 按 provider thread id 查找 session，用于把 app-server 通知归属到正确会话。
   */
  findSessionByThreadId(threadId: string): CodexAppServerSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.providerThreadId === threadId) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * transport 关闭或报错时，将所有 running session 显式标记为 failed。
   */
  markRunningSessionsFailed(errorMessage: string): void {
    for (const session of this.sessions.values()) {
      if (session.status !== 'running') continue;
      session.status = 'failed';
      session.activeTurnId = null;
      session.turnStartedAt = null;
      const sessionId = session.providerThreadId || session.ozwSessionId;
      session.writer?.send({ type: 'codex-error', error: errorMessage, sessionId });
      session.writer?.send({
        type: 'session-status',
        sessionId,
        provider: 'codex',
        isProcessing: false,
      });
    }
  }

  /**
   * 清理所有测试 session，并释放 streaming batcher。
   */
  clear(): void {
    for (const session of this.sessions.values()) {
      session.streamingDeltaBatcher?.dispose();
    }
    this.sessions.clear();
  }

  /**
   * 返回当前仍在运行的 Codex app-server session。
   */
  getActiveSessions(): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const session of this.sessions.values()) {
      if (session.status === 'running') {
        result.push({
          id: session.providerThreadId || session.ozwSessionId,
          turnId: session.activeTurnId,
          status: session.status,
          startedAt: '',
          projectPath: session.projectPath,
          ozwSessionId: session.ozwSessionId,
          provider: 'codex',
        });
      }
    }
    return result;
  }

  /**
   * 生成 session map key。
   */
  private getSessionId(ozwSessionId: string, projectPath: string): string {
    return `${ozwSessionId}:${projectPath}`;
  }
}
