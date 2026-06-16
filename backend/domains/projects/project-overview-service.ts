/**
 * PURPOSE: Typed project overview service for provider session lists,
 * transcript messages, and project-local session summaries.
 */
import path from 'path';

import { buildProjectOverviewReadModel } from './project-overview-read-model.js';
import { buildProviderSessionListReadModel } from './provider-session-list-read-model.js';
import {
  findProjectChatRecord,
  getManualSessionDraftMap,
  getSessionWorkflowMetadataMap,
  isPlainRecord,
  loadProjectConfig,
  normalizeProjectPath,
  type LooseRecord,
} from './project-config-read-model.js';
import {
  countProviderSessionsForProject as countIndexedProviderSessionsForProject,
  deleteProviderSessionIndexFile as deleteIndexedProviderSessionFile,
  getProviderSessionProjectPathForFile as getIndexedProviderSessionProjectPathForFile,
  indexProviderSessionFile as indexProviderSessionFileInReadModel,
  listIndexedProviderSessionsForProject,
  upsertProviderSessionIndex,
} from './provider-session-read-model.js';
import { buildPiSessionsIndex } from './provider-session-index-read-model.js';
import { listWorkflowReadModels } from '../workflows/workflow-read-model.js';
import {
  getCodexSessionMessages,
  getPiSessionMessages,
  listCodexSessionFiles,
  listPiSessionFiles,
  parseCodexSessionHeader,
  parsePiSessionHeader,
  readJsonlFirstRecord,
  sessionBelongsToProject,
} from './provider-transcript-read-model.js';

export { buildProjectOverviewReadModel } from './project-overview-read-model.js';
export { buildProviderSessionListReadModel } from './provider-session-list-read-model.js';
export {
  getCodexSessionMessages,
  getPiSessionMessages,
  parseCodexSessionHeader,
  parsePiSessionHeader,
  readJsonlFirstRecord,
} from './provider-transcript-read-model.js';

/**
 * Read project sessions from stored project chat records.
 */
export async function getSessions(projectName: unknown = '', limit: unknown = 5, offset: unknown = 0, options: LooseRecord = {}) {
  const projectPath = String(options.projectPath || projectName || '');
  const config = await loadProjectConfig(projectPath);
  const sessions = Object.entries(isPlainRecord(config.chat) ? config.chat : {})
    .map(([routeIndex, record]) => isPlainRecord(record) ? routeRecordToSession(routeIndex, record, projectPath) : null)
    .filter((session): session is LooseRecord => Boolean(session));
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const normalizedLimit = Math.max(0, Number(limit) || 0);
  const sortedSessions = sessions.sort(sortByLastActivityDesc);
  return {
    sessions: normalizedLimit > 0 ? sortedSessions.slice(normalizedOffset, normalizedOffset + normalizedLimit) : sortedSessions,
    hasMore: normalizedLimit > 0 ? sortedSessions.length > normalizedOffset + normalizedLimit : false,
    total: sortedSessions.length,
    offset: normalizedOffset,
    limit: normalizedLimit,
  };
}

/**
 * Read session messages by routing to the owning provider transcript reader.
 */
export async function getSessionMessages(
  _projectName: unknown = '',
  sessionId: unknown = '',
  limit: unknown = null,
  offset: unknown = 0,
  afterLine: unknown = null,
) {
  const codexMessages = await getCodexSessionMessages(sessionId, limit, offset, afterLine);
  if (codexMessages.total > 0) {
    return codexMessages;
  }
  return getPiSessionMessages(sessionId, limit, offset, afterLine);
}

/**
 * Parse project JSONL sessions into the normalized session summary model.
 */
export async function parseJsonlSessions(filePath = '') {
  const header = await parseCodexSessionHeader(filePath) || await parsePiSessionHeader(filePath);
  return {
    sessions: header ? [header] : [],
    entries: [],
  };
}

/**
 * Read a Codex provider session list for a project path.
 */
export async function getCodexSessions(projectPath: unknown = '', options: LooseRecord = {}): Promise<LooseRecord[]> {
  const sessions = await readProviderSessions('codex', String(projectPath || ''), options);
  return mergeProviderSessionsWithRoutes('codex', String(projectPath || ''), sessions, options);
}

/**
 * Read a Pi provider session list for a project path.
 */
export async function getPiSessions(projectPath: unknown = '', options: LooseRecord = {}): Promise<LooseRecord[]> {
  const sessions = await readProviderSessions('pi', String(projectPath || ''), options);
  return mergeProviderSessionsWithRoutes('pi', String(projectPath || ''), sessions, options);
}

/**
 * Return cached Pi sessions grouped by project path.
 */
export async function getCachedPiSessionsIndex(): Promise<Map<string, LooseRecord[]>> {
  return buildPiSessionsIndex();
}

/**
 * Index a provider session file after creation or discovery.
 */
export async function indexProviderSessionFile(provider: unknown = '', filePath: unknown = '') {
  try {
    return await indexProviderSessionFileInReadModel(String(provider), String(filePath));
  } catch {
    return String(provider) === 'pi'
      ? parsePiSessionHeader(String(filePath))
      : parseCodexSessionHeader(String(filePath));
  }
}

/**
 * Delete provider session index rows for a removed transcript file.
 */
export async function deleteProviderSessionIndexFile(provider: unknown = '', filePath: unknown = ''): Promise<void> {
  try {
    await deleteIndexedProviderSessionFile(String(provider), String(filePath));
  } catch {
    // Index storage is best-effort for this read model path.
  }
}

/**
 * Read the project path indexed for one provider transcript file.
 */
export async function getProviderSessionProjectPathForFile(provider: unknown = '', filePath: unknown = ''): Promise<string> {
  /**
   * PURPOSE: Support unlink handling after the underlying JSONL has disappeared.
   */
  try {
    return await getIndexedProviderSessionProjectPathForFile(String(provider), String(filePath));
  } catch {
    return '';
  }
}

/**
 * Count remaining indexed provider sessions for one project path.
 */
export async function countProviderSessionsForProject(projectPath: unknown = ''): Promise<number> {
  /**
   * PURPOSE: Keep provider-only project visibility tied to actual indexed
   * transcript membership.
   */
  try {
    return await countIndexedProviderSessionsForProject(String(projectPath || ''));
  } catch {
    return 0;
  }
}

/**
 * Read raw provider session headers from transcript files.
 */
async function readProviderSessions(provider: 'codex' | 'pi', projectPath: string, options: LooseRecord = {}): Promise<LooseRecord[]> {
  const indexedSessions = await listIndexedProviderSessionsForProject(
    provider,
    projectPath,
    getProviderSessionReadLimit(options.limit),
  );
  if (indexedSessions.length > 0) {
    return indexedSessions.sort(sortByLastActivityDesc);
  }

  const files = provider === 'codex' ? await listCodexSessionFiles() : await listPiSessionFiles();
  const sessions: LooseRecord[] = [];
  for (const filePath of files) {
    const session = provider === 'codex'
      ? await parseCodexSessionHeader(filePath)
      : await parsePiSessionHeader(filePath);
    if (!session || !sessionBelongsToProject(session, projectPath)) {
      continue;
    }
    const normalizedSession = { ...session, provider };
    sessions.push(normalizedSession);
    await upsertProviderSessionIndex(provider, normalizedSession);
  }
  return sessions.sort(sortByLastActivityDesc);
}

/**
 * Merge provider sessions with manual cN route records from config.
 */
async function mergeProviderSessionsWithRoutes(
  provider: 'codex' | 'pi',
  projectPath: string,
  providerSessions: LooseRecord[],
  options: LooseRecord,
): Promise<LooseRecord[]> {
  const config = await loadProjectConfig(projectPath);
  const manualDrafts = [
    ...Object.values(getManualSessionDraftMap(config)).map((draft) => draftToSession(draft as LooseRecord, projectPath)),
    ...Object.entries(isPlainRecord(config.chat) ? config.chat : {})
      .map(([routeIndex, record]) => routeRecordToProviderSession(routeIndex, record as LooseRecord, provider, projectPath))
      .filter((session): session is LooseRecord => Boolean(session)),
  ].filter((session) => session.provider === provider);
  const optionWorkflowOwnedSessionIds = options.workflowOwnedSessionIds instanceof Set
    ? options.workflowOwnedSessionIds
    : null;
  const discoveredWorkflowOwnedSessionIds = optionWorkflowOwnedSessionIds
    ? collectConfigWorkflowOwnedProviderSessionIds(provider, config)
    : await collectWorkflowOwnedProviderSessionIds(projectPath, provider, config);
  const workflowOwnedSessionIds = mergeSessionIdSets(discoveredWorkflowOwnedSessionIds, optionWorkflowOwnedSessionIds);
  const normalizedProviderSessions = await markWorkflowOwnedProviderSessions(provider, providerSessions, workflowOwnedSessionIds);
  const sessions = buildProviderSessionListReadModel({
    provider,
    providerSessions: normalizedProviderSessions,
    manualDrafts,
    workflowOwnedSessionIds,
    includeHidden: options.includeHidden === true,
    excludeWorkflowChildSessions: options.excludeWorkflowChildSessions === true,
  });
  const limit = Number(options.limit);
  return Number.isFinite(limit) && limit > 0 ? sessions.slice(0, limit) : sessions;
}

/**
 * Read enough indexed rows so filtering workflow children still leaves recent
 * manual sessions for the overview card limit.
 */
function getProviderSessionReadLimit(limitValue: unknown): number {
  /**
   * PURPOSE: Keep SQLite reads bounded while avoiding false-empty lists when
   * the newest rows are workflow-owned child sessions.
   */
  const limit = Number(limitValue);
  if (Number.isFinite(limit) && limit > 0) {
    return Math.max(50, Math.floor(limit) * 5);
  }
  return 200;
}

/**
 * Merge explicit workflow-owned ids from the overview caller with ids discovered
 * from project config and run state.
 */
function mergeSessionIdSets(base: Set<string>, extra: unknown): Set<string> {
  /**
   * PURPOSE: Let buildProjectOverviewReadModel pass workflow ownership it has
   * already loaded without losing project-local config ownership metadata.
   */
  const merged = new Set<string>(base);
  if (extra instanceof Set) {
    for (const sessionId of extra) {
      const normalizedSessionId = String(sessionId || '').trim();
      if (normalizedSessionId) {
        merged.add(normalizedSessionId);
      }
    }
  }
  return merged;
}

/**
 * Return whether a provider session is owned by a workflow.
 */
function isWorkflowOwnedProviderSession(session: LooseRecord, workflowOwnedSessionIds: Set<string>): boolean {
  /**
   * PURPOSE: Match all provider identity aliases used by Codex, Pi, and routed
   * cN sessions.
   */
  return [
    session?.id,
    session?.providerSessionId,
    session?.provider_session_id,
    session?.sourceSessionId,
    session?.source_session_id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .some((sessionId) => workflowOwnedSessionIds.has(sessionId));
}

/**
 * Mark workflow-owned sessions before list filtering and persist that origin
 * back into the SQLite read model.
 */
async function markWorkflowOwnedProviderSessions(
  provider: 'codex' | 'pi',
  providerSessions: LooseRecord[],
  workflowOwnedSessionIds: Set<string>,
): Promise<LooseRecord[]> {
  /**
   * PURPOSE: Keep future overview reads DB-backed and able to filter workflow
   * child sessions even when JSONL files are no longer scanned on the request path.
   */
  if (workflowOwnedSessionIds.size === 0) {
    return providerSessions;
  }
  const sessionsToPersist: LooseRecord[] = [];
  const normalizedSessions = providerSessions.map((session) => {
    if (!isWorkflowOwnedProviderSession(session, workflowOwnedSessionIds)) {
      return session;
    }
    if (session.origin === 'workflow') {
      return session;
    }
    const workflowSession = { ...session, origin: 'workflow' };
    sessionsToPersist.push(workflowSession);
    return workflowSession;
  });
  await Promise.all(
    sessionsToPersist.map((session) => upsertProviderSessionIndex(provider, session)),
  );
  return normalizedSessions;
}

/**
 * Collect provider-scoped workflow-owned session ids from project-local config.
 */
function collectConfigWorkflowOwnedProviderSessionIds(
  provider: 'codex' | 'pi',
  config: LooseRecord,
): Set<string> {
  const sessionIds = new Set<string>();
  const addIfProviderMatches = (sessionId: unknown, sessionProvider: unknown = provider) => {
    const normalizedProvider = String(sessionProvider || provider).trim() || provider;
    const normalizedSessionId = String(sessionId || '').trim();
    if (normalizedSessionId && normalizedProvider === provider) {
      sessionIds.add(normalizedSessionId);
    }
  };

  const workflowMetadata = getSessionWorkflowMetadataMap(config);
  for (const [sessionId, metadata] of Object.entries(workflowMetadata)) {
    if (isPlainRecord(metadata) && metadata.workflowId) {
      addIfProviderMatches(sessionId, metadata.provider);
    }
  }

  const configWorkflows = isPlainRecord(config.workflows) ? config.workflows : {};
  for (const workflow of Object.values(configWorkflows)) {
    const workflowChat = isPlainRecord(workflow) && isPlainRecord(workflow.chat) ? workflow.chat : {};
    for (const route of Object.values(workflowChat)) {
      if (!isPlainRecord(route)) {
        continue;
      }
      addIfProviderMatches(route.sessionId, route.provider);
      addIfProviderMatches(route.providerSessionId, route.provider);
    }
  }

  return sessionIds;
}

/**
 * Collect provider-scoped workflow-owned session ids from config and run state.
 */
async function collectWorkflowOwnedProviderSessionIds(
  projectPath: string,
  provider: 'codex' | 'pi',
  config: LooseRecord,
): Promise<Set<string>> {
  const sessionIds = collectConfigWorkflowOwnedProviderSessionIds(provider, config);
  const addIfProviderMatches = (sessionId: unknown, sessionProvider: unknown = provider) => {
    const normalizedProvider = String(sessionProvider || provider).trim() || provider;
    const normalizedSessionId = String(sessionId || '').trim();
    if (normalizedSessionId && normalizedProvider === provider) {
      sessionIds.add(normalizedSessionId);
    }
  };

  try {
    const workflows = await listWorkflowReadModels(projectPath);
    for (const workflow of workflows) {
      const workflowSessions = Array.isArray(workflow.workflowOwnedSessionRefs)
        ? workflow.workflowOwnedSessionRefs
        : Array.isArray(workflow.childSessions) ? workflow.childSessions : [];
      const runnerProcesses = Array.isArray(workflow.runnerProcesses) ? workflow.runnerProcesses : [];
      for (const session of workflowSessions) {
        addIfProviderMatches(session?.sessionId || session?.id, session?.provider);
      }
      for (const process of runnerProcesses) {
        addIfProviderMatches(process?.session_id || process?.sessionId, process?.provider);
      }
      const runnerDiagnostics = isPlainRecord(workflow.runnerDiagnostics) ? workflow.runnerDiagnostics : {};
      const diagnostics = isPlainRecord(workflow.diagnostics) ? workflow.diagnostics : {};
      const runnerDiagnosticSessions = Array.isArray(runnerDiagnostics.workflowOwnedSessions)
        ? runnerDiagnostics.workflowOwnedSessions
        : [];
      const diagnosticSessions = Array.isArray(diagnostics.workflowOwnedSessions)
        ? diagnostics.workflowOwnedSessions
        : [];
      for (const session of runnerDiagnosticSessions) {
        addIfProviderMatches(session?.sessionId || session?.id, session?.provider);
      }
      for (const session of diagnosticSessions) {
        addIfProviderMatches(session?.sessionId || session?.id, session?.provider);
      }
    }
  } catch (error) {
    console.warn(`[Projects] Could not load workflow-owned sessions for ${projectPath}:`, error);
  }

  return sessionIds;
}

/**
 * Convert a project chat route record into overview session shape.
 */
function routeRecordToSession(routeIndex: string, record: LooseRecord, projectPath: string): LooseRecord {
  const now = new Date().toISOString();
  return {
    id: record.sessionId,
    routeIndex: Number(routeIndex),
    title: record.title || record.summary || record.sessionId,
    summary: record.summary || record.title || record.sessionId,
    provider: record.provider || 'codex',
    projectPath,
    lastActivity: record.updatedAt || record.createdAt || now,
    updated_at: record.updatedAt || record.createdAt || now,
    createdAt: record.createdAt || record.updatedAt || now,
    providerSessionId: record.providerSessionId,
    origin: record.origin,
    stageKey: record.stageKey,
    workflowId: record.workflowId,
  };
}

/**
 * Convert a config route record into a provider list session.
 */
function routeRecordToProviderSession(routeIndex: string, record: LooseRecord, provider: string, projectPath: string): LooseRecord | null {
  if (!record?.sessionId || (record.provider && record.provider !== provider)) {
    return null;
  }
  const numericRouteIndex = Number(routeIndex);
  if (!Number.isInteger(numericRouteIndex) || numericRouteIndex <= 0) {
    return null;
  }
  const routeSessionId = `c${numericRouteIndex}`;
  const rawSessionId = String(record.sessionId || '');
  const providerSessionId = record.providerSessionId || (rawSessionId === routeSessionId ? '' : rawSessionId);
  if (!providerSessionId && rawSessionId === routeSessionId) {
    return null;
  }
  return {
    ...routeRecordToSession(routeIndex, record, projectPath),
    id: routeSessionId,
    provider,
    providerSessionId,
    projectPath,
  };
}

/**
 * Convert a manual draft record into a provider list session.
 */
function draftToSession(draft: LooseRecord, projectPath: string): LooseRecord {
  const now = new Date().toISOString();
  return {
    id: draft.id,
    routeIndex: draft.routeIndex,
    title: draft.label || draft.title || draft.id,
    summary: draft.label || draft.summary || draft.id,
    provider: draft.provider || 'codex',
    providerSessionId: draft.providerSessionId,
    projectPath: draft.projectPath || projectPath,
    lastActivity: draft.updatedAt || draft.createdAt || now,
    updated_at: draft.updatedAt || draft.createdAt || now,
    createdAt: draft.createdAt || draft.updatedAt || now,
    origin: draft.origin,
    workflowId: draft.workflowId,
    stageKey: draft.stageKey,
  };
}

/**
 * Sort sessions newest first.
 */
function sortByLastActivityDesc(sessionA: LooseRecord, sessionB: LooseRecord): number {
  return new Date(sessionB.lastActivity || sessionB.updated_at || sessionB.createdAt || 0).getTime()
    - new Date(sessionA.lastActivity || sessionA.updated_at || sessionA.createdAt || 0).getTime();
}

/**
 * Group provider sessions by normalized project path.
 */
function groupSessionsByProject(sessions: LooseRecord[]): Map<string, LooseRecord[]> {
  const grouped = new Map<string, LooseRecord[]>();
  for (const session of sessions) {
    const projectPath = normalizeProjectPath(session.projectPath || session.cwd || path.dirname(session.filePath || ''));
    grouped.set(projectPath, [...(grouped.get(projectPath) || []), session]);
  }
  return grouped;
}
