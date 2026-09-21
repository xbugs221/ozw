/**
 * 文件目的：解析项目当前 tmux 客户端聚焦的 pane，并映射到 Provider 会话。
 * 业务意义：渲染记录必须跟随用户在 tmux 中切换后的实际 window，不能只
 * 根据浏览器 URL 或上一次创建的 route 推断会话。
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { createTmuxTerminalRuntime } from './terminal-tmux-runtime.js';

const execFileAsync = promisify(execFile);

type LooseRecord = Record<string, any>;
type Provider = 'codex' | 'pi' | 'claude';

export type CurrentTmuxResolutionStatus = 'resolved' | 'no-tmux' | 'unresolved';

export type TmuxPaneEvidence = {
  source: 'attached-client' | 'active-pane';
  sessionName: string;
  windowIndex: number | null;
  windowName: string;
  windowActive: boolean;
  windowActivity: number | null;
  paneIndex: number | null;
  paneId: string;
  panePid: number | null;
  paneCurrentPath: string;
  paneCurrentCommand: string;
  paneStartCommand: string;
  paneTitle: string;
  paneTty: string;
  clientPid: number | null;
  clientTty: string;
  clientActivity: number | null;
};

export type CurrentTmuxResolution = {
  status: CurrentTmuxResolutionStatus;
  session: LooseRecord | null;
  provider: Provider | null;
  routeSessionId: string | null;
  providerSessionId: string | null;
  evidence: TmuxPaneEvidence | null;
  reason?: string;
};

type TmuxRow = {
  sessionName: string;
  windowIndex: number | null;
  windowName: string;
  windowActive: boolean;
  windowActivity: number | null;
  paneIndex: number | null;
  paneId: string;
  panePid: number | null;
  paneCurrentPath: string;
  paneCurrentCommand: string;
  paneStartCommand: string;
  paneTitle: string;
  paneTty: string;
  clientPid: number | null;
  clientTty: string;
  clientActivity: number | null;
};

type TmuxCommandResult = {
  ok: boolean;
  stdout: string;
  error?: unknown;
};

export type CurrentTmuxSessionDependencies = {
  getCodexSessions: (projectPath?: string, options?: LooseRecord) => Promise<LooseRecord[]> | LooseRecord[];
  getPiSessions: (projectPath?: string, options?: LooseRecord) => Promise<LooseRecord[]> | LooseRecord[];
  getClaudeSessions: (projectPath?: string, options?: LooseRecord) => Promise<LooseRecord[]> | LooseRecord[];
  execFile?: typeof execFileAsync;
};

const ROW_SEPARATOR = '\t';
const CLIENT_FORMAT = [
  '#{client_pid}',
  '#{client_tty}',
  '#{session_name}',
  '#{window_index}',
  '#{window_name}',
  '#{window_active}',
  '#{window_activity}',
  '#{pane_index}',
  '#{pane_id}',
  '#{pane_pid}',
  '#{pane_current_path}',
  '#{pane_current_command}',
  '#{pane_start_command}',
  '#{pane_title}',
  '#{pane_tty}',
  '#{client_activity}',
].join(ROW_SEPARATOR);
const PANE_FORMAT = [
  '#{session_name}',
  '#{window_index}',
  '#{window_name}',
  '#{window_active}',
  '#{window_activity}',
  '#{pane_index}',
  '#{pane_active}',
  '#{pane_id}',
  '#{pane_pid}',
  '#{pane_current_path}',
  '#{pane_current_command}',
  '#{pane_start_command}',
  '#{pane_title}',
  '#{pane_tty}',
].join(ROW_SEPARATOR);

function parseNumber(value: unknown): number | null {
  /** Convert tmux's empty/unknown fields without leaking NaN into the API. */
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: unknown): boolean {
  /** Normalize tmux's 0/1 flags while accepting its true/false spelling. */
  return value === 1 || value === '1' || value === true || value === 'true';
}

function splitRows(output: string): string[][] {
  /** Drop the final newline but keep empty fields in the fixed-width format. */
  return String(output || '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(ROW_SEPARATOR));
}

function parseClientRow(values: string[]): TmuxRow | null {
  /** Parse one attached client row using the same field order as CLIENT_FORMAT. */
  if (values.length < 16 || !values[2]) return null;
  return {
    clientPid: parseNumber(values[0]),
    clientTty: values[1] || '',
    sessionName: values[2] || '',
    windowIndex: parseNumber(values[3]),
    windowName: values[4] || '',
    windowActive: parseBoolean(values[5]),
    windowActivity: parseNumber(values[6]),
    paneIndex: parseNumber(values[7]),
    paneId: values[8] || '',
    panePid: parseNumber(values[9]),
    paneCurrentPath: values[10] || '',
    paneCurrentCommand: values[11] || '',
    paneStartCommand: values[12] || '',
    paneTitle: values[13] || '',
    paneTty: values[14] || '',
    clientActivity: parseNumber(values[15]),
  };
}

function parsePaneRow(values: string[]): TmuxRow | null {
  /** Parse one all-pane row; pane_active is folded into windowActive for ranking. */
  if (values.length < 14 || !values[0]) return null;
  return {
    clientPid: null,
    clientTty: '',
    sessionName: values[0] || '',
    windowIndex: parseNumber(values[1]),
    windowName: values[2] || '',
    windowActive: parseBoolean(values[3]) || parseBoolean(values[6]),
    windowActivity: parseNumber(values[4]),
    paneIndex: parseNumber(values[5]),
    paneId: values[7] || '',
    panePid: parseNumber(values[8]),
    paneCurrentPath: values[9] || '',
    paneCurrentCommand: values[10] || '',
    paneStartCommand: values[11] || '',
    paneTitle: values[12] || '',
    paneTty: values[13] || '',
    clientActivity: null,
  };
}

function toEvidence(row: TmuxRow, source: TmuxPaneEvidence['source']): TmuxPaneEvidence {
  /** Keep the raw pane facts visible to the frontend for diagnostics and trust. */
  return { ...row, source };
}

function normalizePath(value: unknown): string {
  /** Compare pane paths and project paths without changing returned evidence. */
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return path.resolve(text);
  } catch {
    return text.replace(/\\/g, '/').replace(/\/+$/, '');
  }
}

function pathMatches(row: TmuxRow, projectPath: string): boolean {
  /** Only panes in the requested project can influence a render selection. */
  return normalizePath(row.paneCurrentPath) === normalizePath(projectPath);
}

function rankAttachedClient(left: TmuxRow, right: TmuxRow): number {
  /** Newer client activity is the best available proxy for the user's focused client. */
  const byClientActivity = (right.clientActivity ?? Number.NEGATIVE_INFINITY)
    - (left.clientActivity ?? Number.NEGATIVE_INFINITY);
  if (byClientActivity !== 0) return byClientActivity;
  return (right.windowActivity ?? Number.NEGATIVE_INFINITY)
    - (left.windowActivity ?? Number.NEGATIVE_INFINITY);
}

function rankActivePane(left: TmuxRow, right: TmuxRow): number {
  /** Prefer tmux's active window marker, then the latest pane activity. */
  const byActiveWindow = Number(right.windowActive) - Number(left.windowActive);
  if (byActiveWindow !== 0) return byActiveWindow;
  return (right.windowActivity ?? Number.NEGATIVE_INFINITY)
    - (left.windowActivity ?? Number.NEGATIVE_INFINITY);
}

function inferIdentity(row: TmuxRow): {
  provider: Provider | null;
  routeSessionId: string | null;
  providerSessionId: string | null;
} {
  /** Infer identity from the focused pane evidence, with managed window names first. */
  const windowName = String(row.windowName || '').trim();
  const processText = [row.paneCurrentCommand, row.paneStartCommand, row.paneTitle].join(' ');
  const windowProviderMatch = windowName.match(/^(codex|pi|claude|plain-shell)_/i);
  const processProviderMatch = processText.match(/(?:^|[\s/'"=])(codex|pi|claude)(?:$|[\s/'"-])/i);
  const providerToken = (windowProviderMatch?.[1] || processProviderMatch?.[1] || '').toLowerCase();
  const provider = providerToken === 'codex' || providerToken === 'pi' || providerToken === 'claude'
    ? providerToken
    : null;

  const routeMatch = [windowName, processText]
    .map((value) => value.match(/(?:^|[_:\s-])(?:route[_:]?)?(c\d+)(?:$|[_:\s-])/i))
    .find(Boolean);
  const routeSessionId = routeMatch?.[1]?.toLowerCase() || null;

  const providerSessionMatch = processText.match(/(?:^|\s)(?:resume|--resume|--session|--session-id)\s+["']?([A-Za-z0-9][A-Za-z0-9._:-]*)/i)
    || windowName.match(/^(?:codex|pi|claude)_([0-9a-f]{8,}(?:-[0-9a-f]{4,}){0,4})$/i);
  const providerSessionId = routeSessionId ? null : providerSessionMatch?.[1] || null;

  return { provider, routeSessionId, providerSessionId };
}

function sessionIds(session: LooseRecord): Set<string> {
  /** Match route, provider, and source aliases emitted by all read models. */
  return new Set([
    session.id,
    session.sessionId,
    session.providerSessionId,
    session.provider_session_id,
    session.sourceSessionId,
    session.source_session_id,
  ].map((value) => String(value || '').trim()).filter(Boolean));
}

function sessionProvider(session: LooseRecord): Provider | null {
  /** Provider lists are annotated here instead of trusting untyped payloads. */
  const value = String(session.__provider || session.provider || '').toLowerCase();
  return value === 'codex' || value === 'pi' || value === 'claude' ? value : null;
}

function sessionRouteId(session: LooseRecord): string | null {
  /** Resolve cN from either the route index or the stable route id. */
  const routeIndex = Number(session.routeIndex);
  if (Number.isInteger(routeIndex) && routeIndex > 0) return `c${routeIndex}`;
  const id = String(session.id || '').trim().toLowerCase();
  return /^c\d+$/.test(id) ? id : null;
}

function chooseSession(
  sessions: Array<{ provider: Provider; session: LooseRecord }>,
  identity: ReturnType<typeof inferIdentity>,
): { provider: Provider; session: LooseRecord } | null {
  /** Map pane identity to one provider record and avoid guessing across providers. */
  let candidates = sessions;
  if (identity.provider) {
    const providerCandidates = candidates.filter((item) => item.provider === identity.provider);
    if (providerCandidates.length > 0) candidates = providerCandidates;
  }
  if (identity.routeSessionId) {
    const routeCandidates = candidates.filter((item) => sessionRouteId(item.session) === identity.routeSessionId);
    if (routeCandidates.length > 0) {
      return routeCandidates.length === 1
        ? routeCandidates[0]
        : routeCandidates.find((item) => item.provider === identity.provider) || null;
    }
  }
  if (identity.providerSessionId) {
    const providerIdCandidates = candidates.filter((item) => sessionIds(item.session).has(identity.providerSessionId!));
    if (providerIdCandidates.length > 0) {
      return providerIdCandidates.length === 1
        ? providerIdCandidates[0]
        : providerIdCandidates.find((item) => item.provider === identity.provider) || null;
    }
  }
  if (!identity.provider) return null;
  if (candidates.length === 1) return candidates[0];

  /** A newly created CLI window may have no id in its process command; latest activity is the best evidence. */
  return [...candidates].sort((left, right) => {
    const getTime = (session: LooseRecord) => new Date(
      session.lastActivity || session.updated_at || session.updatedAt || session.createdAt || 0,
    ).getTime();
    return getTime(right.session) - getTime(left.session);
  })[0] || null;
}

async function runTmux(
  executor: typeof execFileAsync,
  args: string[],
): Promise<TmuxCommandResult> {
  /** Execute only bounded, read-only tmux queries for this resolver. */
  try {
    const result = await executor('tmux', args, { timeout: 2_000 });
    return { ok: true, stdout: String(result.stdout || '') };
  } catch (error) {
    return { ok: false, stdout: '', error };
  }
}

export async function resolveCurrentTmuxSession(
  projectPath: string,
  deps: CurrentTmuxSessionDependencies,
): Promise<CurrentTmuxResolution> {
  /** Resolve the focused pane first, then map it to complete backend session metadata. */
  const normalizedProjectPath = normalizePath(projectPath);
  if (!normalizedProjectPath) {
    return { status: 'no-tmux', session: null, provider: null, routeSessionId: null, providerSessionId: null, evidence: null, reason: 'project-path-missing' };
  }
  const executor = deps.execFile || execFileAsync;
  const sessionList = await runTmux(executor, ['list-sessions', '-F', '#{session_name}']);
  if (!sessionList.ok) {
    return { status: 'no-tmux', session: null, provider: null, routeSessionId: null, providerSessionId: null, evidence: null, reason: 'tmux-unavailable' };
  }

  const managedRuntime = createTmuxTerminalRuntime(`${normalizedProjectPath}_plain-shell_new`);
  const managedSessionNames = new Set([managedRuntime.sessionName, ...managedRuntime.legacySessionNames]);
  const knownSessionNames = new Set(String(sessionList.stdout || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
  const clientResult = await runTmux(executor, ['list-clients', '-F', CLIENT_FORMAT]);
  const paneResult = await runTmux(executor, ['list-panes', '-a', '-F', PANE_FORMAT]);
  const clientRows = clientResult.ok ? splitRows(clientResult.stdout).map(parseClientRow).filter(Boolean) as TmuxRow[] : [];
  const paneRows = paneResult.ok ? splitRows(paneResult.stdout).map(parsePaneRow).filter(Boolean) as TmuxRow[] : [];
  const managedClients = clientRows
    .filter((row) => managedSessionNames.has(row.sessionName) && pathMatches(row, normalizedProjectPath))
    .sort(rankAttachedClient);
  const projectClients = clientRows
    .filter((row) => pathMatches(row, normalizedProjectPath))
    .sort(rankAttachedClient);
  const managedPanes = paneRows
    .filter((row) => managedSessionNames.has(row.sessionName) && pathMatches(row, normalizedProjectPath))
    .sort(rankActivePane);
  const projectPanes = paneRows
    .filter((row) => pathMatches(row, normalizedProjectPath))
    .sort(rankActivePane);
  const activeRow = managedClients[0] || projectClients[0] || managedPanes[0] || projectPanes[0] || null;
  if (!activeRow) {
    const hasManagedSession = [...managedSessionNames].some((name) => knownSessionNames.has(name));
    return {
      status: hasManagedSession ? 'unresolved' : 'no-tmux',
      session: null,
      provider: null,
      routeSessionId: null,
      providerSessionId: null,
      evidence: null,
      reason: hasManagedSession ? 'project-pane-not-found' : 'project-tmux-session-not-found',
    };
  }

  const identity = inferIdentity(activeRow);
  const [codexSessions, piSessions, claudeSessions] = await Promise.all([
    Promise.resolve(deps.getCodexSessions(normalizedProjectPath, { includeHidden: true })),
    Promise.resolve(deps.getPiSessions(normalizedProjectPath, { includeHidden: true })),
    Promise.resolve(deps.getClaudeSessions(normalizedProjectPath, { includeHidden: true })),
  ]);
  const sessions = [
    ...(Array.isArray(codexSessions) ? codexSessions : []).map((session) => ({ provider: 'codex' as const, session })),
    ...(Array.isArray(piSessions) ? piSessions : []).map((session) => ({ provider: 'pi' as const, session })),
    ...(Array.isArray(claudeSessions) ? claudeSessions : []).map((session) => ({ provider: 'claude' as const, session })),
  ];
  const selected = chooseSession(sessions, identity);
  const source: TmuxPaneEvidence['source'] = activeRow.clientPid !== null ? 'attached-client' : 'active-pane';
  if (!selected) {
    return {
      status: 'unresolved',
      session: null,
      provider: identity.provider,
      routeSessionId: identity.routeSessionId,
      providerSessionId: identity.providerSessionId,
      evidence: toEvidence(activeRow, source),
      reason: identity.provider ? 'provider-session-not-found' : 'pane-provider-not-found',
    };
  }

  const resolvedSession: LooseRecord = {
    ...selected.session,
    __provider: selected.provider,
    projectPath: selected.session.projectPath || normalizedProjectPath,
  };
  return {
    status: 'resolved',
    session: resolvedSession,
    provider: selected.provider,
    routeSessionId: sessionRouteId(resolvedSession) || identity.routeSessionId,
    providerSessionId: String(resolvedSession.providerSessionId || resolvedSession.id || identity.providerSessionId || '').trim() || null,
    evidence: toEvidence(activeRow, source),
  };
}
