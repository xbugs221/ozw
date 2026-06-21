/**
 * PURPOSE: Define the typed handoff for starting provider-backed agent work.
 */

import { randomUUID } from 'node:crypto';
import { sendCodexAppServerMessage } from '../codex-app-server/runtime-facade.js';

export type AgentSessionRunRequest = {
  projectPath: string;
  message: string;
  provider: string;
  model?: string;
};

export type AgentSessionWriter = {
  send(data: unknown): void;
  end(): void;
  setSessionId(sessionId: string): void;
  getSessionId(): string | null;
};

type AgentRuntimeEvent = {
  type?: unknown;
  error?: unknown;
};

function parseAgentRuntimeEvent(data: unknown): AgentRuntimeEvent | null {
  /** Normalize writer payloads so terminal app-server events can drive route completion. */
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === 'object' ? parsed as AgentRuntimeEvent : null;
    } catch {
      return null;
    }
  }
  return data && typeof data === 'object' ? data as AgentRuntimeEvent : null;
}

function createTerminalAwareWriter(writer: AgentSessionWriter): {
  writer: AgentSessionWriter;
  waitForTerminalEvent: () => Promise<void>;
} {
  /** Forward all events while resolving only after the Codex turn reaches a terminal state. */
  let settleTerminalEvent: (() => void) | null = null;
  let terminalError: Error | null = null;
  let terminalObserved = false;
  const terminalPromise = new Promise<void>((resolve) => {
    settleTerminalEvent = resolve;
  });

  return {
    writer: {
      send(data: unknown): void {
        writer.send(data);
        const event = parseAgentRuntimeEvent(data);
        if (event?.type === 'codex-complete') {
          terminalObserved = true;
          settleTerminalEvent?.();
        }
        if (event?.type === 'codex-error') {
          terminalObserved = true;
          terminalError = new Error(String(event.error || 'Codex app-server turn failed'));
          settleTerminalEvent?.();
        }
      },
      end(): void {
        writer.end();
      },
      setSessionId(sessionId: string): void {
        writer.setSessionId(sessionId);
      },
      getSessionId(): string | null {
        return writer.getSessionId();
      },
    },
    waitForTerminalEvent: async (): Promise<void> => {
      /** Await the terminal event unless it already arrived synchronously. */
      if (terminalObserved) {
        if (terminalError) {
          throw terminalError;
        }
        return;
      }
      await terminalPromise;
      if (terminalError) {
        throw terminalError;
      }
    },
  };
}

export function validateAgentSessionRunRequest(request: AgentSessionRunRequest): AgentSessionRunRequest {
  /** Ensure a route has the minimum fields required before invoking a provider session. */
  if (!request.projectPath || !request.message || !request.provider) {
    throw new Error('projectPath, message and provider are required');
  }
  return request;
}

export async function runAgentSession(request: AgentSessionRunRequest, writer: AgentSessionWriter): Promise<void> {
  /** Start the provider-backed session after the route has resolved project context. */
  const validated = validateAgentSessionRunRequest(request);
  const terminalAware = createTerminalAwareWriter(writer);
  await sendCodexAppServerMessage({
    ozwSessionId: terminalAware.writer.getSessionId() || `agent:${randomUUID()}`,
    projectPath: validated.projectPath,
    text: validated.message.trim(),
    model: validated.model || undefined,
    permissionMode: process.env.OZW_AGENT_PERMISSION_MODE || 'acceptEdits',
    writer: terminalAware.writer,
  });
  await terminalAware.waitForTerminalEvent();
}

export const __agentSessionRunnerInternalsForTest = {
  createTerminalAwareWriter,
  parseAgentRuntimeEvent,
};
