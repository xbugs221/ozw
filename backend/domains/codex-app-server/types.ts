/**
 * 文件目的：定义 Codex app-server runtime 的可复用边界类型。
 */
export interface RuntimeWriter {
  send(data: unknown): void;
  setSessionId?(sessionId: string): void;
  setSessionIndexContext?(context: unknown): void;
}
