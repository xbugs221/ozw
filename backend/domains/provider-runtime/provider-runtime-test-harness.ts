/**
 * 文件目的：承载 provider runtime 的测试 harness。
 * 业务意义：业务流验收可以注入 fake adapter，同时生产 facade 不直接包含测试主体。
 */
import type { Provider } from './provider-runtime-events.js';
import { findRuntimeSession, getOrCreateCodexSession, getOrCreatePiSession, type CodexSessionRecord, type PiSessionRecord } from './runtime-session-store.js';
import type { RunningBehavior } from './runtime-router.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

export type RuntimeHarness = {
  sendMessage(input: {
    provider: Provider;
    sessionId: string;
    projectPath: string;
    text: string;
    runningBehavior?: RunningBehavior;
  }): Promise<{ accepted: boolean; queued?: boolean; providerSessionId?: string }>;
  abortSession(input: { provider: Provider; sessionId: string }): Promise<{ aborted: boolean }>;
  releaseProvider(provider: Provider, label?: string): Promise<void>;
  readMessages(input: { provider: Provider; sessionId: string }): Promise<Array<{ role: string; content: string }>>;
  getAdapterEvents(provider: Provider): Array<{ type: string; text?: string; behavior?: string }>;
};

type FakeAdapterEvent = { type: string; text?: string; behavior?: string };

class FakeCodexAdapter {
  events: FakeAdapterEvent[] = [];
  private turnResolvers: Array<() => void> = [];
  labels: string[] = [];
  private pendingTurns: Array<{ label: string; ozwSessionId: string }> = [];

  pushEvent(event: FakeAdapterEvent) {
    this.events.push(event);
  }

  resolveTurn(label: string) {
    this.labels.push(label);
    const resolver = this.turnResolvers.shift();
    if (resolver) {
      resolver();
    } else {
      // No waiter yet – record for future resolution
      this.pendingTurns.push({ label, ozwSessionId: '' });
    }
  }

  /** Register that a turn is now in-flight. Returns a promise resolved by resolveTurn. */
  startTurn(): Promise<void> {
    // Drain any pre-resolved turns first
    const pending = this.pendingTurns.shift();
    if (pending) {
      this.labels.push(pending.label);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.turnResolvers.push(resolve);
    });
  }
}

class FakePiAdapter {
  events: FakeAdapterEvent[] = [];
  private turnResolvers: Array<() => void> = [];
  labels: string[] = [];
  private pendingTurns: Array<{ label: string }> = [];

  pushEvent(event: FakeAdapterEvent) {
    this.events.push(event);
  }

  resolveTurn(label: string) {
    this.labels.push(label);
    const resolver = this.turnResolvers.shift();
    if (resolver) {
      resolver();
    } else {
      this.pendingTurns.push({ label });
    }
  }

  startTurn(): Promise<void> {
    const pending = this.pendingTurns.shift();
    if (pending) {
      this.labels.push(pending.label);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.turnResolvers.push(resolve);
    });
  }
}

/**
 * Create a test harness that injects fake adapters so acceptance tests can
 * verify business semantics without calling real SDKs.
 *
 * Each call returns independent adapter instances so tests do not share event state.
 */
export function createNativeAgentRuntimeForTest(): RuntimeHarness {
  const codexAdapter = new FakeCodexAdapter();
  const piAdapter = new FakePiAdapter();

  return {
    async sendMessage({ provider, sessionId, projectPath, text, runningBehavior }) {
      if (provider === 'codex') {
        const session = getOrCreateCodexSession(sessionId, projectPath || process.cwd(), null);
        if ((session.status as string) === 'running' && runningBehavior === 'steer') {
          if (!session.activeTurnId) {
            return { accepted: false };
          }
          codexAdapter.pushEvent({ type: 'steer', text, behavior: runningBehavior });
          return { accepted: true };
        }
        codexAdapter.pushEvent({ type: 'send', text, behavior: runningBehavior });
        if ((session.status as string) === 'running' && runningBehavior === 'abort-and-send') {
          session.status = 'aborted';
          session.activeTurnId = null;
          codexAdapter.pushEvent({ type: 'abort' });
        }
        session.status = 'running';
        session.activeTurnId = `turn-${Date.now()}`;
        session.turnStartedAt = new Date().toISOString();
        // Start turn asynchronously; releaseProvider resolves it
        codexAdapter.startTurn().then(() => {
          session.status = 'completed';
          session.activeTurnId = null;
          session.turnStartedAt = null;
        });
        return { accepted: true, providerSessionId: `codex-${sessionId}` };
      }

      if (provider === 'pi') {
        piAdapter.pushEvent({ type: 'queue', text, behavior: runningBehavior });
        const session = getOrCreatePiSession(sessionId, projectPath || process.cwd(), null);
        session.status = 'running';
        session.turnStartedAt = new Date().toISOString();
        piAdapter.startTurn().then(() => {
          session.status = 'completed';
          session.turnStartedAt = null;
        });
        return { accepted: true, providerSessionId: `pi-${sessionId}` };
      }

      return { accepted: false };
    },

    async abortSession({ provider, sessionId }) {
      if (provider === 'codex') {
        const session = findRuntimeSession('codex', sessionId) as CodexSessionRecord | undefined;
        if (!session || (session.status as string) !== 'running') return { aborted: false };
        session.status = 'aborted';
        session.activeTurnId = null;
        session.turnStartedAt = null;
        codexAdapter.pushEvent({ type: 'abort' });
        return { aborted: true };
      }
      if (provider === 'pi') {
        const session = findRuntimeSession('pi', sessionId) as PiSessionRecord | undefined;
        if (!session || (session.status as string) !== 'running') return { aborted: false };
        session.status = 'aborted';
        session.turnStartedAt = null;
        piAdapter.pushEvent({ type: 'abort' });
        return { aborted: true };
      }
      return { aborted: false };
    },

    async releaseProvider(provider, label) {
      if (provider === 'codex') {
        codexAdapter.resolveTurn(label || 'done');
      } else {
        piAdapter.resolveTurn(label || 'done');
      }
    },

    async readMessages({ provider, sessionId }) {
      if (provider === 'codex') {
        const allEvents = codexAdapter.events;
        // Skip send events that were aborted (before the last abort marker)
        let lastAbortIndex = -1;
        for (let i = allEvents.length - 1; i >= 0; i -= 1) {
          if (allEvents[i].type === 'abort') {
            lastAbortIndex = i;
            break;
          }
        }
        const sends = allEvents
          .slice(lastAbortIndex + 1)
          .filter((e) => e.type === 'send' || e.type === 'steer');
        const msgs: Array<{ role: string; content: string }> = [];
        const labels = codexAdapter.labels;
        let labelIndex = 0;
        for (const ev of sends) {
          msgs.push({ role: 'user', content: ev.text || '' });
          if (labelIndex < labels.length) {
            msgs.push({ role: 'assistant', content: labels[labelIndex] });
            labelIndex += 1;
          }
        }
        return msgs;
      }
      if (provider === 'pi') {
        const allEvents = piAdapter.events;
        let lastAbortIndex = -1;
        for (let i = allEvents.length - 1; i >= 0; i -= 1) {
          if (allEvents[i].type === 'abort') {
            lastAbortIndex = i;
            break;
          }
        }
        const sends = allEvents
          .slice(lastAbortIndex + 1)
          .filter((e) => e.type === 'queue');
        const msgs: Array<{ role: string; content: string }> = [];
        const labels = piAdapter.labels;
        let labelIndex = 0;
        for (const ev of sends) {
          msgs.push({ role: 'user', content: ev.text || '' });
          if (labelIndex < labels.length) {
            msgs.push({ role: 'assistant', content: labels[labelIndex] });
            labelIndex += 1;
          }
        }
        return msgs;
      }
      return [];
    },

    getAdapterEvents(provider) {
      return provider === 'codex' ? [...codexAdapter.events] : [...piAdapter.events];
    },
  };
}

