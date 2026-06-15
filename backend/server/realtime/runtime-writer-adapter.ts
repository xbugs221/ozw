/**
 * 文件目的：定义 provider runtime writer 到 WebSocket 事件的适配边界。
 * 业务意义：Codex/Pi runtime 输出需要带稳定 session 身份，避免投递到错误的前端会话。
 */

/**
 * 包装 runtime writer，统一暴露 session 上下文能力。
 */
export function createRuntimeWriterAdapter(writer: any) {
    return {
        send(data: unknown) {
            writer.send(data);
        },
        setSessionId(sessionId: string) {
            writer.setSessionId?.(sessionId);
        },
        setSessionIndexContext(context: unknown) {
            writer.setSessionIndexContext?.(context);
        },
    };
}
