/**
 * PURPOSE: Isolate agent response event shapes from Express response handling.
 */

import type { Response } from 'express';

export type AgentResponseEvent = {
  type: string;
  [key: string]: unknown;
};

export function formatAgentResponseEvent(event: AgentResponseEvent): string {
  /** Serialize one server-sent event payload for the agent route writer. */
  return `data: ${JSON.stringify(event)}\n\n`;
}

export class SSEStreamWriter {
  private sessionId: string | null = null;
  readonly isSSEStreamWriter = true;

  constructor(private readonly res: Response) {}

  send(data: AgentResponseEvent): void {
    /** Write one agent event to the SSE response when the connection is open. */
    if (this.res.writableEnded) {
      return;
    }
    this.res.write(formatAgentResponseEvent(data));
  }

  end(): void {
    /** Close the SSE stream with the standard done event. */
    if (!this.res.writableEnded) {
      this.res.write(formatAgentResponseEvent({ type: 'done' }));
      this.res.end();
    }
  }

  setSessionId(sessionId: string): void {
    /** Store the provider session id surfaced by the runtime. */
    this.sessionId = sessionId;
  }

  getSessionId(): string | null {
    /** Return the provider session id if one has been observed. */
    return this.sessionId;
  }
}

export class ResponseCollector {
  private messages: unknown[] = [];
  private sessionId: string | null = null;

  send(data: unknown): void {
    /** Collect provider events so non-streaming responses can be summarized. */
    this.messages.push(data);
    const parsed = this.parseMessage(data);
    const sessionId = parsed?.sessionId;
    if (typeof sessionId === 'string') {
      this.sessionId = sessionId;
    }
  }

  end(): void {
    /** Non-streaming collection has no transport to close. */
  }

  setSessionId(sessionId: string): void {
    /** Store the provider session id surfaced by the runtime. */
    this.sessionId = sessionId;
  }

  getSessionId(): string | null {
    /** Return the provider session id if one has been observed. */
    return this.sessionId;
  }

  getMessages(): unknown[] {
    /** Return all collected raw provider events. */
    return this.messages;
  }

  private parseMessage(msg: unknown): Record<string, unknown> | null {
    /** Parse a collected writer message into an object when possible. */
    if (typeof msg === 'string') {
      try {
        const parsed = JSON.parse(msg);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }
    return msg && typeof msg === 'object' ? msg as Record<string, unknown> : null;
  }

  private upsertAssistantMessage(assistantMessages: Record<string, unknown>[], itemIndexes: Map<string, number>, message: Record<string, unknown>, itemId: string | null): void {
    /** Add or replace the latest assistant message for a Codex item. */
    if (!itemId) {
      assistantMessages.push(message);
      return;
    }
    const existingIndex = itemIndexes.get(itemId);
    if (existingIndex !== undefined) {
      assistantMessages[existingIndex] = message;
      return;
    }
    itemIndexes.set(itemId, assistantMessages.length);
    assistantMessages.push(message);
  }

  getAssistantMessages(): Record<string, unknown>[] {
    /** Return assistant messages from Codex item events, deduplicated by item id. */
    const assistantMessages: Record<string, unknown>[] = [];
    const itemIndexes = new Map<string, number>();

    for (const msg of this.messages) {
      const parsed = this.parseMessage(msg);
      if (!parsed || parsed.type === 'status') {
        continue;
      }

      const codexData = parsed.type === 'codex-response' && parsed.data && typeof parsed.data === 'object'
        ? parsed.data as Record<string, unknown>
        : null;
      const codexMessage = codexData?.message && typeof codexData.message === 'object'
        ? codexData.message as Record<string, unknown>
        : null;

      if (
        codexData?.type === 'item'
        && codexData.itemType === 'agent_message'
        && codexMessage?.role === 'assistant'
        && typeof codexMessage.content === 'string'
        && codexMessage.content.length > 0
      ) {
        this.upsertAssistantMessage(
          assistantMessages,
          itemIndexes,
          codexMessage,
          typeof codexData.itemId === 'string' ? codexData.itemId : null
        );
      }
    }

    return assistantMessages;
  }

  private addCodexUsage(totals: Record<string, number>, usage: unknown): void {
    /** Apply a Codex turn usage payload to the aggregate token summary. */
    if (!usage || typeof usage !== 'object') {
      return;
    }
    const record = usage as Record<string, unknown>;
    const inputTokens = Number(record.input_tokens) || 0;
    const outputTokens = Number(record.output_tokens) || 0;
    const cachedInputTokens = Number(record.cached_input_tokens) || 0;
    const reasoningOutputTokens = Number(record.reasoning_output_tokens) || 0;
    const totalTokens = Number(record.total_tokens);

    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    totals.cacheReadTokens += cachedInputTokens;
    totals.reasoningOutputTokens += reasoningOutputTokens;
    totals.totalTokens += Number.isFinite(totalTokens)
      ? totalTokens
      : inputTokens + outputTokens + cachedInputTokens + reasoningOutputTokens;
  }

  getTotalTokens(): Record<string, unknown> {
    /** Calculate token totals from Codex completion events and context fallback data. */
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    };
    let contextBudget: unknown = null;

    for (const msg of this.messages) {
      const parsed = this.parseMessage(msg);
      if (!parsed) {
        continue;
      }
      const codexData = parsed.type === 'codex-response' && parsed.data && typeof parsed.data === 'object'
        ? parsed.data as Record<string, unknown>
        : null;
      if (codexData?.type === 'turn_complete') {
        this.addCodexUsage(totals, codexData.usage);
      }
      if (parsed.type === 'token-budget' && parsed.data && typeof parsed.data === 'object') {
        contextBudget = parsed.data;
      }
    }

    if (totals.totalTokens === 0 && contextBudget && typeof contextBudget === 'object') {
      const used = Number((contextBudget as Record<string, unknown>).used);
      if (Number.isFinite(used)) {
        totals.totalTokens = used;
      }
    }

    return { ...totals, contextBudget };
  }
}
