/**
 * OpenAI Codex CLI Integration
 * =============================
 *
 * This module runs Codex CLI non-interactive sessions for the agent API route.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with Codex CLI JSON streaming
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import {
  buildSessionTokenUsagePayload,
  getCodexSessionTokenUsage,
} from './session-token-usage.js';
import { appendAttachmentNote } from './chat-attachments.js';
import {
  formatCodexCliNotFoundMessage,
  resolveCodexCliPath,
} from './codex-cli.js';
import { transformCodexEvent } from '../shared/codex-message-normalizer.js';
import { resolveCodexPermissionPolicy } from './codex-permission-policy.js';

// Track active sessions
type CodexActiveSession = { status: "running" | "completed" | "aborted" | "failed"; abortController: AbortController; startedAt: string; projectPath: string; };
type CodexCliEvent = Record<string, any>;
type CodexWriter = { send(data: unknown): void; setSessionId?(sessionId: string): void; isSSEStreamWriter?: boolean; isWebSocketWriter?: boolean; };
type QueryCodexOptions = { sessionId?: string; cwd?: string; projectPath?: string; model?: string; reasoningEffort?: string; attachments?: unknown; clientRequestId?: string; permissionMode?: string; highPermissionApproved?: boolean; };
type CodexExecArgsInput = { command: string; sessionId?: string | null; workingDirectory?: string; model?: string | null; reasoningEffort?: string | null; sandboxMode?: string | null; approvalPolicy?: string | null; };
type CodexCliFallbackInput = CodexExecArgsInput & { timeoutMs?: number; signal?: AbortSignal; onEvent?: (event: CodexCliEvent) => void | Promise<void>; };
type CodexCliResult = { threadId: string | null; turn: { items: unknown[]; usage: unknown } };

const activeCodexSessions = new Map<string, CodexActiveSession>();
let shellProxyEnvPromise: Promise<NodeJS.ProcessEnv> | null = null;
const CODEX_SESSIONS_ROOT = process.env.CODEX_SESSIONS_DIR || path.join(os.homedir(), '.codex', 'sessions');
const CBW_ROUTE_SESSION_PATTERN = /^c\d+$/;

function isCbwRouteSessionId(sessionId: unknown): boolean {
  return typeof sessionId === 'string' && CBW_ROUTE_SESSION_PATTERN.test(sessionId.trim());
}

function normalizeCodexPermissionMode(permissionMode: unknown): "acceptEdits" | "bypassPermissions" | "default" {
  if (permissionMode === 'acceptEdits' || permissionMode === 'bypassPermissions' || permissionMode === 'default') {
    return permissionMode;
  }
  return 'default';
}
export const __transformCodexEventForTest = transformCodexEvent;

/**
 * Read Codex session token usage and make fallback decisions observable.
 */
async function getCodexSessionTokenUsageOrNull(sessionId: string): Promise<unknown | null> {
  try {
    return await getCodexSessionTokenUsage(sessionId);
  } catch (error) {
    console.warn('[Codex] Failed to read session token usage:', (error as { message?: string }).message || error);
    return null;
  }
}

function mapPermissionModeToCodexOptions(permissionMode: string, highPermissionApproved = false) {
  /**
   * PURPOSE: Resolve UI permission intent through the shared Codex policy helper
   * and require an explicit approval flag before high-risk runtime elevation.
   */
  return resolveCodexPermissionPolicy({ permissionMode, highPermissionApproved });
}

async function resolveShellProxyEnv(): Promise<NodeJS.ProcessEnv> {
  if (shellProxyEnvPromise) {
    return shellProxyEnvPromise;
  }

  shellProxyEnvPromise = new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/sh';
    const child = spawn(shell, ['-lc', 'env -0'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });

    let stdout = Buffer.alloc(0);
    let settled = false;

    const finish = (env: NodeJS.ProcessEnv = {}) => {
      if (settled) return;
      settled = true;
      resolve(env || {});
    };

    child.stdout?.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    });

    child.on('error', () => finish({}));

    child.on('close', (code) => {
      if (code !== 0) {
        finish({});
        return;
      }

      const text = stdout.toString('utf8');
      if (!text) {
        finish({});
        return;
      }

      const keys = new Set([
        'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
        'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'
      ]);
      const shellProxyEnv: NodeJS.ProcessEnv = {};

      for (const entry of text.split('\0')) {
        if (!entry) continue;
        const idx = entry.indexOf('=');
        if (idx <= 0) continue;
        const key = entry.slice(0, idx);
        if (!keys.has(key)) continue;
        shellProxyEnv[key] = entry.slice(idx + 1);
      }

      finish(shellProxyEnv);
    });
  });

  return shellProxyEnvPromise;
}

/**
 * Locate the persisted Codex transcript for one session id.
 * Resume validation relies on Codex's own session metadata rather than route-derived UI state.
 *
 * @param {string} sessionId
 * @param {string} rootDir
 * @returns {Promise<string|null>}
 */
async function findCodexSessionTranscript(sessionId: string | null | undefined, rootDir = CODEX_SESSIONS_ROOT): Promise<string | null> {
  if (!sessionId) {
    return null;
  }

  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.includes(sessionId)) {
        return fullPath;
      }
    }
  }

  return null;
}

/**
 * Read the recorded session cwd from the transcript metadata header.
 *
 * @param {string} sessionId
 * @param {string} rootDir
 * @returns {Promise<string>}
 */
async function readCodexSessionWorkingDirectory(sessionId: string, rootDir = CODEX_SESSIONS_ROOT): Promise<string> {
  const transcriptPath = await findCodexSessionTranscript(sessionId, rootDir);
  if (!transcriptPath) {
    return '';
  }

  const raw = await fs.readFile(transcriptPath, 'utf8');
  const [firstLine = ''] = raw.split('\n');
  if (!firstLine.trim()) {
    return '';
  }

  const parsed = JSON.parse(firstLine);
  return typeof parsed?.payload?.cwd === 'string' ? parsed.payload.cwd : '';
}

/**
 * Block resumed Codex sessions from silently switching across unrelated project roots.
 *
 * @param {string|null|undefined} sessionId
 * @param {string} workingDirectory
 * @param {string} rootDir
 * @returns {Promise<void>}
 */
async function assertResumeSessionWorkingDirectory(sessionId: string | null | undefined, workingDirectory: string, rootDir = CODEX_SESSIONS_ROOT): Promise<void> {
  if (!sessionId || !workingDirectory) {
    return;
  }

  const persistedCwd = await readCodexSessionWorkingDirectory(sessionId, rootDir);
  if (!persistedCwd) {
    return;
  }

  const normalizedPersistedCwd = path.resolve(persistedCwd);
  const normalizedRequestedCwd = path.resolve(workingDirectory);
  if (normalizedPersistedCwd === normalizedRequestedCwd) {
    return;
  }

  throw new Error(
    `Cannot resume Codex session ${sessionId} in ${normalizedRequestedCwd}: the recorded session cwd is ${normalizedPersistedCwd}. Start a new session instead.`,
  );
}

async function runCodexCliFallback({
  command,
  sessionId,
  workingDirectory,
  model,
  sandboxMode,
  approvalPolicy,
  timeoutMs,
  signal,
  onEvent
}: CodexCliFallbackInput): Promise<{ threadId: string | null; turn: { items: unknown[]; usage: unknown } }> {
  const shellProxyEnv = await resolveShellProxyEnv();
  const childEnv = buildCodexChildEnv(shellProxyEnv, workingDirectory);

  return await new Promise<CodexCliResult>((resolve, reject) => {
    const args = buildCodexExecArgs({
      command,
      sessionId,
      workingDirectory,
      model,
      sandboxMode,
      approvalPolicy,
    });

    const codexCliPath = resolveCodexCliPath({ env: childEnv });
    const child = spawn(codexCliPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv
    });
    let threadId = sessionId || null;
    let usage: unknown = null;
    const items: unknown[] = [];
    let stderr = '';
    let settled = false;

    const finish = (err: Error | null, result?: { threadId: string | null; turn: { items: unknown[]; usage: unknown } }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener);
      }
      if (err) reject(err);
      else resolve(result || { threadId, turn: { items, usage } });
    };

    const effectiveTimeoutMs = Number(timeoutMs);
    const hasTimeout = Number.isFinite(effectiveTimeoutMs) && effectiveTimeoutMs > 0;
    const timer = hasTimeout ? setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      const details = stderr.trim();
      finish(new Error(
        details
          ? `Codex CLI fallback timeout after ${Math.floor(effectiveTimeoutMs / 1000)}s: ${details}`
          : `Codex CLI fallback timeout after ${Math.floor(effectiveTimeoutMs / 1000)}s`
      ));
    }, effectiveTimeoutMs) : null;

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (!line?.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof onEvent === 'function') {
        onEvent(event);
      }

      if (event.type === 'thread.started') {
        threadId = event.thread_id || event.id || threadId;
      } else if (event.type === 'item.completed' && event.item) {
        items.push(event.item);
      } else if (event.type === 'turn.completed' && event.usage) {
        usage = event.usage;
      } else if (event.type === 'turn.failed') {
        finish(new Error(event.error?.message || 'Codex turn failed'));
      } else if (event.type === 'error') {
        finish(new Error(event.message || 'Codex error'));
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        finish(new Error(formatCodexCliNotFoundMessage(codexCliPath, childEnv)));
        return;
      }
      finish(err);
    });

    child.on('close', (code) => {
      rl.close();
      if (code !== 0) {
        const details = stderr.trim() || `codex exited with code ${code}`;
        finish(new Error(details));
        return;
      }
      finish(null, {
        threadId,
        turn: { items, usage }
      });
    });

    let abortListener: (() => void) | null = null;
    if (signal) {
      abortListener = () => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }
  });
}

/**
 * Build the environment for one Codex CLI subprocess.
 * Keep shell-derived proxy variables, strip nested agent marker variables, and bind
 * context-mode MCP servers to the active Codex working directory.
 *
 * @param {object} shellProxyEnv - Proxy-related variables resolved from the login shell.
 * @param {string|null|undefined} workingDirectory - Active Codex session directory.
 * @returns {NodeJS.ProcessEnv} Environment for the spawned Codex CLI process.
 */
function buildCodexChildEnv(shellProxyEnv: NodeJS.ProcessEnv = {}, workingDirectory?: string | null): NodeJS.ProcessEnv {
  const childEnv = { ...process.env, ...shellProxyEnv };
  // Remove CLAUDECODE so the codex subprocess is not mistaken for a nested agent session.
  // Preserve the active shell/system proxy configuration rather than forcing a
  // fixed localhost port that may not exist on the current machine.
  delete childEnv.CLAUDECODE;
  delete childEnv.CODEX_THREAD_ID;
  delete childEnv.CODEX_SESSION_ID;

  if (workingDirectory) {
    // context-mode falls back to process.cwd() when no project dir env is set.
    // Pin it to the active Codex working directory so MCP shell tools execute
    // inside the session project instead of the host server cwd.
    childEnv.CONTEXT_MODE_PROJECT_DIR = workingDirectory;
  }

  return childEnv;
}

/**
 * Build Codex CLI arguments for one turn execution.
 * When resuming an existing session, model must not be passed because the
 * thread model is already fixed server-side by Codex.
 * @param {object} params - Argument builder input.
 * @param {string} params.command - User prompt.
 * @param {string|null|undefined} params.sessionId - Existing session id.
 * @param {string} params.workingDirectory - Working directory.
 * @param {string|null|undefined} params.model - Requested model.
 * @param {string|null|undefined} params.reasoningEffort - Requested reasoning effort.
 * @param {string|null|undefined} params.sandboxMode - Sandbox mode.
 * @param {string|null|undefined} params.approvalPolicy - Approval policy.
 * @returns {string[]} Codex CLI argument array.
 */
function buildCodexExecArgs({
  command,
  sessionId,
  workingDirectory,
  model,
  reasoningEffort,
  sandboxMode,
  approvalPolicy,
}: CodexExecArgsInput): string[] {
  const args = ['exec', '--json'];

  // Resumed threads keep their original model, passing --model can trigger
  // mismatch errors such as resuming a thread with a different requested model.
  if (model && !sessionId) {
    args.push('--model', model);
  }

  if (reasoningEffort) {
    args.push('-c', `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  }

  if (sandboxMode) {
    args.push('--sandbox', sandboxMode);
  }

  if (workingDirectory) {
    args.push('--cd', workingDirectory);
  }

  args.push('--skip-git-repo-check');

  if (approvalPolicy) {
    // Codex CLI v0.106+ configures approval policy through -c overrides.
    // Keep the value quoted so TOML parsing treats it as a string literal.
    args.push('-c', `approval_policy=${JSON.stringify(approvalPolicy)}`);
  }

  if (sessionId) {
    args.push('resume', sessionId);
  }

  if (command?.trim()) {
    args.push(command);
  }

  return args;
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryCodex(command: string, options: QueryCodexOptions = {}, ws: CodexWriter) {
  const {
    sessionId,
    cwd,
    projectPath,
    model,
    reasoningEffort,
    attachments,
    clientRequestId,
    permissionMode = 'default',
    highPermissionApproved = false
  } = options;
  const requestId = typeof clientRequestId === 'string' ? clientRequestId : null;
  let failed = false;

  const workingDirectory = cwd || projectPath || process.cwd();
  const effectivePermissionMode = normalizeCodexPermissionMode(permissionMode);
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(effectivePermissionMode, highPermissionApproved === true);

  const providerSessionId = isCbwRouteSessionId(sessionId) ? '' : (sessionId || '');
  let currentSessionId: string = providerSessionId;
  const shouldEmitSessionCreatedEarly = Boolean(providerSessionId);
  let sessionCreatedSent = false;
  const abortController = new AbortController();
  const runTimeoutMs = Number(process.env.CODEX_RUN_TIMEOUT_MS || 600000);

  const finalCommand = appendAttachmentNote(command, Array.isArray(attachments) ? attachments as Record<string, unknown>[] : []);

  try {
    await assertResumeSessionWorkingDirectory(providerSessionId, workingDirectory);

    currentSessionId = providerSessionId || `codex-${Date.now()}`;

    // Track the session
    activeCodexSessions.set(currentSessionId, {
      status: 'running',
      abortController,
      startedAt: new Date().toISOString(),
      projectPath: workingDirectory,
    });

    // For resumed sessions, sessionId is already stable so emit immediately.
    // For new sessions, wait until thread.started to avoid temporary ID mismatch.
    if (shouldEmitSessionCreatedEarly) {
      sendMessage(ws, {
        type: 'session-created',
        sessionId: currentSessionId,
        provider: 'codex',
        clientRequestId: requestId
      });
      sessionCreatedSent = true;
      if (typeof ws?.setSessionId === 'function') {
        ws.setSessionId(currentSessionId);
      }
    }

    const fallback = await runCodexCliFallback({
      command: finalCommand,
      sessionId: providerSessionId,
      workingDirectory,
      model,
      reasoningEffort,
      sandboxMode,
      approvalPolicy,
      timeoutMs: runTimeoutMs,
      signal: abortController.signal,
      onEvent: async (event) => {
        if (event?.type === 'thread.started') {
          const fallbackThreadId = event.thread_id || event.id;
          if (fallbackThreadId && fallbackThreadId !== currentSessionId) {
            const existingSession = activeCodexSessions.get(currentSessionId);
            if (existingSession) {
              activeCodexSessions.delete(currentSessionId);
              activeCodexSessions.set(fallbackThreadId, existingSession);
            }
            currentSessionId = fallbackThreadId;
            // When resumed session resolves to a different thread id, notify clients so
            // frontend session filters and routing switch to the effective session id.
            sendMessage(ws, {
              type: 'session-created',
              sessionId: currentSessionId,
              provider: 'codex',
              clientRequestId: requestId
            });
            if (typeof ws?.setSessionId === 'function') {
              ws.setSessionId(currentSessionId);
            }
            sessionCreatedSent = true;
          }
          if (!sessionCreatedSent) {
            sendMessage(ws, {
              type: 'session-created',
              sessionId: currentSessionId,
              provider: 'codex',
              clientRequestId: requestId
            });
            sessionCreatedSent = true;
            if (typeof ws?.setSessionId === 'function') {
              ws.setSessionId(currentSessionId);
            }
          }
          return;
        }

        const transformed = transformCodexEvent(event);
        if (event?.type === 'item.completed' || event?.type === 'item.updated' || event?.type === 'item.started' || event?.type === 'turn.completed' || event?.type === 'turn.failed') {
          sendMessage(ws, {
            type: 'codex-response',
            data: transformed,
            sessionId: currentSessionId
          });
        }

        if (event?.type === 'turn.completed' && event?.usage) {
          const tokenBudget =
            await getCodexSessionTokenUsageOrNull(currentSessionId) ||
            buildSessionTokenUsagePayload({
              used: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
              total: 200000,
              source: 'codex-turn-completed-fallback',
            });
          sendMessage(ws, {
            type: 'token-budget',
            data: tokenBudget,
            sessionId: currentSessionId
          });
        }
      }
    });

    const fallbackThreadId = fallback.threadId;
    const resolvedSessionId = fallbackThreadId || currentSessionId;
    if (resolvedSessionId !== currentSessionId) {
      const existingSession = activeCodexSessions.get(currentSessionId);
      if (existingSession) {
        activeCodexSessions.delete(currentSessionId);
        activeCodexSessions.set(resolvedSessionId, existingSession);
      }
      currentSessionId = resolvedSessionId;
    }

    if (!sessionCreatedSent) {
      sendMessage(ws, {
        type: 'session-created',
        sessionId: currentSessionId,
        provider: 'codex',
        clientRequestId: requestId
      });
      sessionCreatedSent = true;
      if (typeof ws?.setSessionId === 'function') {
        ws.setSessionId(currentSessionId);
      }
    }

    // Send completion event
    sendMessage(ws, {
      type: 'codex-complete',
      sessionId: currentSessionId,
      actualSessionId: currentSessionId
    });
    return currentSessionId;

  } catch (error) {
    const session = currentSessionId ? activeCodexSessions.get(currentSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      (error as { name?: string }).name === 'AbortError' ||
      String((error as { message?: string }).message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      failed = true;
      console.error('[Codex] Error:', error);
      sendMessage(ws, {
        type: 'codex-error',
        error: (error as { message?: string }).message || 'Codex error',
        sessionId: currentSessionId
      });
    }
    throw error;

  } finally {
    // Update session status
    if (currentSessionId) {
      const session = activeCodexSessions.get(currentSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : failed ? 'failed' : 'completed';
      }
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId: string): boolean {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId: string): boolean {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions(): Array<{ id: string; status: string; startedAt: string; projectPath: string }> {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt,
        projectPath: session.projectPath || '',
      });
    }
  }

  return sessions;
}

/**
 * Expose argument builder for unit tests.
 * @param {object} params - Same as buildCodexExecArgs input.
 * @returns {string[]} Built CLI args.
 */
export function __buildCodexExecArgsForTest(params: CodexExecArgsInput): string[] {
  return buildCodexExecArgs(params);
}

export function __buildCodexChildEnvForTest(shellProxyEnv: NodeJS.ProcessEnv, workingDirectory?: string | null): NodeJS.ProcessEnv {
  return buildCodexChildEnv(shellProxyEnv, workingDirectory);
}

/**
 * Test-only export: map a UI permissionMode to the runtime { sandboxMode,
 * approvalPolicy } pair used for Codex CLI invocation. Exposed so behavior
 * tests can pin permission-mode semantics without depending on internal
 * source structure.
 *
 * @param {string} permissionMode - 'default' | 'acceptEdits' | 'bypassPermissions'.
 * @returns {{sandboxMode: string, approvalPolicy: string}} Runtime options.
 */
export function __mapPermissionModeToCodexOptionsForTest(permissionMode: string, highPermissionApproved = false) {
  return mapPermissionModeToCodexOptions(normalizeCodexPermissionMode(permissionMode), highPermissionApproved === true);
}

export async function __findCodexSessionTranscriptForTest(sessionId: string, rootDir: string) {
  return findCodexSessionTranscript(sessionId, rootDir);
}

export async function __readCodexSessionWorkingDirectoryForTest(sessionId: string, rootDir: string) {
  return readCodexSessionWorkingDirectory(sessionId, rootDir);
}

export async function __assertResumeSessionWorkingDirectoryForTest(sessionId: string, workingDirectory: string, rootDir: string) {
  return assertResumeSessionWorkingDirectory(sessionId, workingDirectory, rootDir);
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws: CodexWriter, data: unknown): void {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
const activeCodexSessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
activeCodexSessionCleanupTimer.unref?.();
