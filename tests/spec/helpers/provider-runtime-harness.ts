/**
 * PURPOSE: Shared browser WebSocket harness for provider runtime specs. It
 * records sent messages and emits provider events through the production
 * browser WebSocket surface.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export interface ProviderRuntimeHarnessOptions {
  provider?: 'codex' | 'pi';
  sentKey?: string;
  eventsKey?: string;
  socketKey?: string;
  emitKey?: string;
  onSendKey?: string;
}

const DEFAULT_OPTIONS: Required<ProviderRuntimeHarnessOptions> = {
  provider: 'codex',
  sentKey: '__providerRuntimeSentMessages',
  eventsKey: '__providerRuntimeEvents',
  socketKey: '__providerRuntimeSocket',
  emitKey: '__providerRuntimeEmit',
  onSendKey: '__providerRuntimeOnSend',
};

/**
 * Install a deterministic FakeWebSocket in the browser page.
 */
export async function installProviderRuntimeHarness(
  page: Page,
  options: ProviderRuntimeHarnessOptions = {},
): Promise<void> {
  /**
   * PURPOSE: Replace only the transport layer while preserving real React UI,
   * reducers, routing, auth, and project APIs.
   */
  const harnessOptions = { ...DEFAULT_OPTIONS, ...options };
  await page.addInitScript((injectedOptions) => {
    const opts = injectedOptions as Required<ProviderRuntimeHarnessOptions>;
    const win = window as unknown as Window & Record<string, unknown>;
    win[opts.sentKey] = [];
    win[opts.eventsKey] = [];
    window.localStorage.setItem('selected-provider', opts.provider);
    window.localStorage.setItem('userLanguage', 'zh-CN');

    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      url: string;
      readyState = FakeWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        super();
        this.url = url;
        win[opts.socketKey] = this;
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          const event = new Event('open');
          this.onopen?.(event);
          this.dispatchEvent(event);
        }, 0);
      }

      send(payload: string): void {
        let parsedPayload: unknown = payload;
        const sent = win[opts.sentKey] as unknown[];
        try {
          parsedPayload = JSON.parse(payload);
          sent.push(parsedPayload);
        } catch {
          sent.push(payload);
        }
        const onSend = win[opts.onSendKey] as ((message: unknown) => void) | undefined;
        onSend?.(parsedPayload);
      }

      close(): void {
        this.readyState = FakeWebSocket.CLOSED;
        const event = new Event('close');
        this.onclose?.(event);
        this.dispatchEvent(event);
      }
    }

    win.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    win[opts.emitKey] = (message: unknown) => {
      const events = win[opts.eventsKey] as unknown[];
      events.push(message);
      const socket = win[opts.socketKey] as FakeWebSocket | undefined;
      const event = new MessageEvent('message', { data: JSON.stringify(message) });
      socket?.onmessage?.(event);
      socket?.dispatchEvent(event);
    };
  }, harnessOptions);
}

/**
 * Emit a raw provider runtime message through a named harness emitter.
 */
export async function emitProviderRuntimeMessage(
  page: Page,
  message: Record<string, unknown>,
  options: Pick<ProviderRuntimeHarnessOptions, 'emitKey'> = {},
): Promise<void> {
  /**
   * PURPOSE: Keep test code focused on provider events rather than browser
   * MessageEvent plumbing.
   */
  await page.evaluate(({ emitKey, message: runtimeMessage }) => {
    const win = window as unknown as Window & Record<string, unknown>;
    const emit = win[emitKey || '__providerRuntimeEmit'] as ((message: unknown) => void) | undefined;
    emit?.(runtimeMessage);
  }, { emitKey: options.emitKey, message });
}

/**
 * Build a message-accepted provider event.
 */
export function emitMessageAccepted(fields: Record<string, unknown> = {}): Record<string, unknown> {
  /**
   * PURPOSE: Share the accepted event shape used to bind optimistic user rows.
   */
  return { type: 'message-accepted', provider: 'codex', ...fields };
}

/**
 * Build a session-status provider event.
 */
export function emitSessionStatus(fields: Record<string, unknown> = {}): Record<string, unknown> {
  /**
   * PURPOSE: Share running/completed status events across provider specs.
   */
  return { type: 'session-status', provider: 'codex', isProcessing: true, ...fields };
}

/**
 * Build a provider response event for Codex or Pi.
 */
export function emitProviderResponse(fields: Record<string, unknown> = {}): Record<string, unknown> {
  /**
   * PURPOSE: Cover codex-response and pi-response through one builder.
   */
  const provider = fields.provider === 'pi' ? 'pi' : 'codex';
  return { type: provider === 'pi' ? 'pi-response' : 'codex-response', provider, ...fields };
}

/**
 * Build a provider completion event.
 */
export function emitProviderComplete(fields: Record<string, unknown> = {}): Record<string, unknown> {
  /**
   * PURPOSE: Share the completed status event used by runtime reducers.
   */
  return { type: 'session-status', provider: 'codex', isProcessing: false, ...fields };
}

/**
 * Build a provider error event.
 */
export function emitProviderError(fields: Record<string, unknown> = {}): Record<string, unknown> {
  /**
   * PURPOSE: Share error event construction for negative browser paths.
   */
  return { type: 'error', provider: 'codex', error: 'provider runtime error', ...fields };
}

/**
 * Build a provider abort event.
 */
export function emitProviderAbort(fields: Record<string, unknown> = {}): Record<string, unknown> {
  /**
   * PURPOSE: Share abort event construction for stop/cancel browser paths.
   */
  return { type: 'aborted', provider: 'codex', ...fields };
}

/**
 * Write a local source audit snapshot for provider harness migration evidence.
 */
export async function writeProviderHarnessSourceAudit(
  payload: Record<string, unknown>,
  outputPath = path.join(process.cwd(), 'test-results/provider-runtime-harness/source-audit.json'),
): Promise<void> {
  /**
   * PURPOSE: Store runtime evidence outside git so oz QA can inspect migration
   * state without committing generated artifacts.
   */
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), ...payload }, null, 2)}\n`, 'utf8');
}
