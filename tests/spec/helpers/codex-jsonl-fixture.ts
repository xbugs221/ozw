/**
 * PURPOSE: Shared Codex JSONL fixture helpers for browser and node specs that
 * need realistic provider history files under an isolated HOME.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SESSION_DAY = ['2026', '06', '09'] as const;
const DEFAULT_FIXTURE_HOME = process.env.PLAYWRIGHT_FIXTURE_HOME || process.env.HOME || '/tmp';
const DEFAULT_PROJECT_PATH = process.env.PLAYWRIGHT_FIXTURE_PROJECT_PATH || process.cwd();

export type CodexJsonlEntry = Record<string, unknown>;

export interface WriteCodexSessionFixtureOptions {
  sessionId: string;
  entries?: CodexJsonlEntry[];
  projectPath?: string;
  sessionDay?: readonly string[];
  homeDir?: string;
  model?: string;
  timestamp?: string;
}

export interface CodexSessionFixtureResult {
  sessionId: string;
  projectPath: string;
  sessionFilePath: string;
}

/**
 * Resolve a project path for session_meta without allowing relative paths to
 * escape the primary Playwright workspace by accident.
 */
export function resolveCodexFixtureProjectPath(projectPath = DEFAULT_PROJECT_PATH): string {
  /**
   * PURPOSE: Keep fixture writers explicit about whether they target the
   * primary workspace or an absolute secondary fixture project.
   */
  return path.isAbsolute(projectPath)
    ? path.resolve(projectPath)
    : path.resolve(DEFAULT_PROJECT_PATH, projectPath);
}

/**
 * Build a Codex session_meta row for project discovery.
 */
export function codexSessionMetaEntry(options: {
  sessionId: string;
  projectPath?: string;
  model?: string;
  timestamp?: string;
}): CodexJsonlEntry {
  /**
   * PURPOSE: session_meta is the row the real project API uses to attach a
   * Codex session to a workspace.
   */
  const projectPath = resolveCodexFixtureProjectPath(options.projectPath);
  return {
    type: 'session_meta',
    timestamp: options.timestamp || '2026-06-09T00:00:00.000Z',
    payload: {
      id: options.sessionId,
      cwd: projectPath,
      model: options.model || 'gpt-5-codex',
    },
  };
}

/**
 * Build a user event row in the Codex JSONL event format.
 */
export function codexUserMessageEntry(timestamp: string, message: string): CodexJsonlEntry {
  /**
   * PURPOSE: event_msg/user_message is the real persisted source for user
   * bubbles in Codex history.
   */
  return {
    type: 'event_msg',
    timestamp,
    payload: { type: 'user_message', message },
  };
}

/**
 * Build an assistant text row in the Codex JSONL response format.
 */
export function codexAssistantMessageEntry(timestamp: string, text: string): CodexJsonlEntry {
  /**
   * PURPOSE: response_item/message output_text covers the normal assistant
   * replay path.
   */
  return {
    type: 'response_item',
    timestamp,
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    },
  };
}

/**
 * Build a function_call row for command/tool card replay.
 */
export function codexFunctionCallEntry(
  timestamp: string,
  callId: string,
  name: string,
  args: Record<string, unknown>,
): CodexJsonlEntry {
  /**
   * PURPOSE: function_call rows must be reusable because tool card regressions
   * depend on the exact provider shape.
   */
  return {
    type: 'response_item',
    timestamp,
    payload: {
      type: 'function_call',
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
    },
  };
}

/**
 * Build a function_call_output row for command/tool card replay.
 */
export function codexFunctionOutputEntry(timestamp: string, callId: string, output: string): CodexJsonlEntry {
  /**
   * PURPOSE: function_call_output rows join back to the input card by call_id.
   */
  return {
    type: 'response_item',
    timestamp,
    payload: {
      type: 'function_call_output',
      call_id: callId,
      output,
    },
  };
}

/**
 * Return the JSONL file path used by the real Codex history reader.
 */
export function codexSessionFilePath(
  sessionId: string,
  options: { homeDir?: string; sessionDay?: readonly string[] } = {},
): string {
  /**
   * PURPOSE: Put all browser spec Codex history under the isolated Playwright
   * HOME instead of the developer's real provider history.
   */
  const homeDir = options.homeDir || DEFAULT_FIXTURE_HOME;
  const sessionDay = options.sessionDay || DEFAULT_SESSION_DAY;
  return path.join(homeDir, '.codex', 'sessions', ...sessionDay, `${sessionId}.jsonl`);
}

/**
 * Write a complete Codex JSONL session fixture.
 */
export async function writeCodexSessionFixture(
  options: WriteCodexSessionFixtureOptions,
): Promise<CodexSessionFixtureResult> {
  /**
   * PURPOSE: Seed the real project API discovery path with a valid JSONL file.
   */
  const projectPath = resolveCodexFixtureProjectPath(options.projectPath);
  const sessionFilePath = codexSessionFilePath(options.sessionId, options);
  const entries = [
    codexSessionMetaEntry({
      sessionId: options.sessionId,
      projectPath,
      model: options.model,
      timestamp: options.timestamp,
    }),
    ...(options.entries || []),
  ];
  await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
  await fs.writeFile(sessionFilePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
  await indexCodexFixtureSession(sessionFilePath);
  await bindCodexFixtureManualRoute(options.sessionId, projectPath);
  return { sessionId: options.sessionId, projectPath, sessionFilePath };
}

/**
 * Append rows to an existing Codex JSONL session fixture.
 */
export async function appendCodexSessionEntries(
  sessionId: string,
  entries: CodexJsonlEntry[],
  options: { homeDir?: string; sessionDay?: readonly string[] } = {},
): Promise<string> {
  /**
   * PURPOSE: Let tests simulate Codex persistence catching up after live
   * WebSocket events.
   */
  const sessionFilePath = codexSessionFilePath(sessionId, options);
  await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
  await fs.appendFile(sessionFilePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
  await indexCodexFixtureSession(sessionFilePath);
  return sessionFilePath;
}

/**
 * Refresh the same provider session index that the backend API reads during browser specs.
 */
async function indexCodexFixtureSession(sessionFilePath: string): Promise<void> {
  try {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), 'backend/domains/projects/project-overview-service.ts')).href;
    const { indexProviderSessionFile } = await import(moduleUrl);
    await indexProviderSessionFile('codex', sessionFilePath);
  } catch {
    // File-system discovery remains the fallback path when an isolated spec does not use the index DB.
  }
}

/**
 * Create the manual cN route that browser specs use to open provider-backed sessions.
 */
export async function bindCodexFixtureManualRoute(
  sessionId: string,
  projectPath: string,
  label = sessionId,
): Promise<void> {
  try {
    const {
      createManualSessionDraft,
      finalizeManualSessionRoute,
    } = await import(pathToFileURL(path.join(process.cwd(), 'backend/domains/projects/manual-session-route-read-model.ts')).href);
    const projectName = projectPath.replace(/[\\/:\s~_]/g, '-');
    const draft = await createManualSessionDraft(projectName, projectPath, 'codex', label, {
      providerSessionId: sessionId,
    });
    await finalizeManualSessionRoute(projectName, draft.id, sessionId, 'codex', projectPath);
  } catch {
    // Standalone provider-session discovery remains available for specs that do not need cN routes.
  }
}
