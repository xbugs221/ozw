/**
 * 文件目的：合并 Provider TUI 的高频 PTY 输出，降低远程 WebSocket 消息数量和重绘频率。
 * 业务意义：被动状态更新最多每秒推送一次，同时为用户输入保留低延迟反馈通道。
 */
import type { WebSocket } from 'ws';

export const PROVIDER_TUI_OUTPUT_INTERVAL_MS = 1_000;
export const PROVIDER_TUI_INTERACTIVE_OUTPUT_DELAY_MS = 16;
export const SHELL_REPLAY_BATCH_LIMIT = 60;

export type ShellOutputSession = {
    ws?: WebSocket | null;
    buffer?: string[];
    pendingOutput?: string;
    outputFlushTimer?: NodeJS.Timeout | null;
    interactiveOutputPending?: boolean;
};

type WebSocketState = {
    OPEN: number;
};

type QueueShellOutputOptions = {
    session: ShellOutputSession;
    data: string;
    isPlainShell: boolean;
    WebSocketState: WebSocketState;
    intervalMs?: number;
    interactiveDelayMs?: number;
};

/**
 * 保存少量已合并输出，作为 tmux 屏幕快照不可用时的恢复兜底。
 */
function appendReplayBatch(session: ShellOutputSession, data: string): void {
    const replayBuffer = session.buffer || (session.buffer = []);
    replayBuffer.push(data);
    if (replayBuffer.length > SHELL_REPLAY_BATCH_LIMIT) {
        replayBuffer.splice(0, replayBuffer.length - SHELL_REPLAY_BATCH_LIMIT);
    }
}

/**
 * 立即发送当前合并输出；连接不可用时只保留有限恢复数据。
 */
export function flushShellOutput(session: ShellOutputSession, WebSocketState: WebSocketState): boolean {
    if (session.outputFlushTimer) {
        clearTimeout(session.outputFlushTimer);
        session.outputFlushTimer = null;
    }

    const output = session.pendingOutput || '';
    session.pendingOutput = '';
    if (!output) {
        return false;
    }

    appendReplayBatch(session, output);
    if (!session.ws || session.ws.readyState !== WebSocketState.OPEN) {
        return false;
    }

    session.ws.send(JSON.stringify({
        type: 'output',
        data: output,
    }));
    return true;
}

/**
 * 合并一段 PTY 输出；普通 Shell 立即发送，Provider TUI 默认每秒发送一次。
 */
export function queueShellOutput({
    session,
    data,
    isPlainShell,
    WebSocketState,
    intervalMs = PROVIDER_TUI_OUTPUT_INTERVAL_MS,
    interactiveDelayMs = PROVIDER_TUI_INTERACTIVE_OUTPUT_DELAY_MS,
}: QueueShellOutputOptions): void {
    if (!data) {
        return;
    }

    session.pendingOutput = `${session.pendingOutput || ''}${data}`;
    if (isPlainShell) {
        flushShellOutput(session, WebSocketState);
        return;
    }

    if (session.outputFlushTimer) {
        return;
    }

    const delayMs = session.interactiveOutputPending ? interactiveDelayMs : intervalMs;
    session.interactiveOutputPending = false;
    session.outputFlushTimer = setTimeout(() => {
        session.outputFlushTimer = null;
        flushShellOutput(session, WebSocketState);
    }, delayMs);
}

/**
 * 标记下一批输出来自用户操作，并把已经等待的状态输出并入低延迟反馈。
 */
export function markShellOutputInteractive(
    session: ShellOutputSession,
    WebSocketState: WebSocketState,
    interactiveDelayMs = PROVIDER_TUI_INTERACTIVE_OUTPUT_DELAY_MS,
): void {
    session.interactiveOutputPending = true;
    if (!session.pendingOutput) {
        return;
    }

    if (session.outputFlushTimer) {
        clearTimeout(session.outputFlushTimer);
    }
    session.interactiveOutputPending = false;
    session.outputFlushTimer = setTimeout(() => {
        session.outputFlushTimer = null;
        flushShellOutput(session, WebSocketState);
    }, interactiveDelayMs);
}

/**
 * 清空尚未发送的输出，供屏幕快照恢复和会话销毁避免重复画面。
 */
export function resetShellOutputQueue(session: ShellOutputSession): void {
    if (session.outputFlushTimer) {
        clearTimeout(session.outputFlushTimer);
    }
    session.outputFlushTimer = null;
    session.pendingOutput = '';
    session.interactiveOutputPending = false;
}

/**
 * 取出并清空有限回放数据，确保重连只发送一条兜底消息。
 */
export function takeShellReplay(session: ShellOutputSession): string {
    const replay = (session.buffer || []).join('');
    session.buffer = [];
    return replay;
}
