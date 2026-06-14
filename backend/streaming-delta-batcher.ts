/**
 * PURPOSE: Coalesce provider text deltas before WebSocket delivery so the
 * browser renders live output at a stable cadence instead of token frequency.
 */

export const DEFAULT_STREAMING_DELTA_BATCH_MS = 1000;

export type StreamingDeltaEnvelopeType = 'codex-response' | 'pi-response';
export type StreamingDeltaItemType = 'agent_message' | 'reasoning' | 'thinking';
export type StreamingDeltaMode = 'append' | 'replace';

export interface StreamingDeltaInput {
  envelopeType: StreamingDeltaEnvelopeType;
  sessionId: string;
  itemType: StreamingDeltaItemType;
  itemId: unknown;
  text: string;
  mode?: StreamingDeltaMode;
}

type StreamingDeltaBuffer = {
  envelopeType: StreamingDeltaEnvelopeType;
  sessionId: string;
  itemType: StreamingDeltaItemType;
  itemId: unknown;
  text: string;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * Batch text deltas by provider session and item identity.
 */
export class StreamingDeltaBatcher {
  private readonly buffers = new Map<string, StreamingDeltaBuffer>();

  constructor(
    private readonly send: (event: Record<string, unknown>) => void,
    private readonly batchMs = DEFAULT_STREAMING_DELTA_BATCH_MS,
  ) {}

  /**
   * Add one provider text delta to the current batch window.
   */
  enqueue(input: StreamingDeltaInput): void {
    const text = typeof input.text === 'string' ? input.text : '';
    if (!text) {
      return;
    }

    const key = this.keyFor(input);
    const existing = this.buffers.get(key);
    if (existing) {
      existing.text = input.mode === 'replace' ? text : `${existing.text}${text}`;
      return;
    }

    const buffer: StreamingDeltaBuffer = {
      envelopeType: input.envelopeType,
      sessionId: input.sessionId,
      itemType: input.itemType,
      itemId: input.itemId,
      text,
      timer: null,
    };
    buffer.timer = setTimeout(() => this.flushKey(key), this.batchMs);
    this.buffers.set(key, buffer);
  }

  /**
   * Emit every pending delta immediately.
   */
  flushAll(): void {
    for (const key of Array.from(this.buffers.keys())) {
      this.flushKey(key);
    }
  }

  /**
   * Emit and clear every pending delta for one provider session.
   */
  flushSession(sessionId: string): void {
    for (const [key, buffer] of Array.from(this.buffers.entries())) {
      if (buffer.sessionId === sessionId) {
        this.flushKey(key);
      }
    }
  }

  /**
   * Clear timers without emitting, used only when a runtime is being discarded.
   */
  dispose(): void {
    for (const buffer of this.buffers.values()) {
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
    }
    this.buffers.clear();
  }

  /**
   * Build the stable buffer key for one live provider item.
   */
  private keyFor(input: Pick<StreamingDeltaInput, 'envelopeType' | 'sessionId' | 'itemType' | 'itemId'>): string {
    return [
      input.envelopeType,
      input.sessionId,
      input.itemType,
      String(input.itemId ?? 'unknown'),
    ].join(':');
  }

  /**
   * Emit one buffer as a frontend-compatible in-progress delta event.
   */
  private flushKey(key: string): void {
    const buffer = this.buffers.get(key);
    if (!buffer) {
      return;
    }
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }
    this.buffers.delete(key);

    this.send({
      type: buffer.envelopeType,
      sessionId: buffer.sessionId,
      data: {
        type: 'item',
        itemType: buffer.itemType,
        itemId: buffer.itemId ?? null,
        status: 'in_progress',
        delta: { text: buffer.text },
        message: {
          role: 'assistant',
          ...(buffer.itemType === 'reasoning' || buffer.itemType === 'thinking' ? { isReasoning: true } : {}),
        },
      },
    });
  }
}
