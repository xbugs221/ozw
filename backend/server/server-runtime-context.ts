/**
 * 文件目的：集中描述 legacy server 拆分后的共享运行状态。
 * 业务意义：HTTP routes、WebSocket handler、shell relay 和 watcher 需要共享连接、去重、广播和 PTY 状态，避免拆分后隐式创建多份状态。
 */
import type { WebSocket } from 'ws';

export type CloseableWatcher = { close(): Promise<void> | void };

export type PtySessionRecord = {
    pty?: { kill?: () => void };
    timeoutId?: NodeJS.Timeout | null;
    ws?: WebSocket | null;
    buffer?: string[];
    projectPath?: string;
    sessionId?: string;
};

export type ServerRuntimeContext = {
    connectedClients: Set<WebSocket>;
    chatClientUsers: WeakMap<object, string | null>;
    recentChatRequestIds: Map<string, number>;
    pendingProjectListInvalidations: Map<string, NodeJS.Timeout>;
    ptySessionsMap: Map<string, PtySessionRecord>;
};

export type CreateServerRuntimeContextOptions = {
    connectedClients: Set<WebSocket>;
    chatClientUsers: WeakMap<object, string | null>;
    recentChatRequestIds: Map<string, number>;
    pendingProjectListInvalidations: Map<string, NodeJS.Timeout>;
    ptySessionsMap: Map<string, PtySessionRecord>;
};

/**
 * 绑定已经由启动组装层创建的共享状态容器。
 */
export function createServerRuntimeContext(options: CreateServerRuntimeContextOptions): ServerRuntimeContext {
    return {
        connectedClients: options.connectedClients,
        chatClientUsers: options.chatClientUsers,
        recentChatRequestIds: options.recentChatRequestIds,
        pendingProjectListInvalidations: options.pendingProjectListInvalidations,
        ptySessionsMap: options.ptySessionsMap,
    };
}
