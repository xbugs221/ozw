/**
 * PURPOSE: Typed project config read model for project metadata, cN route
 * state, session UI/model state, and archive decisions.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  readProjectLocalConfigFile,
  writeProjectLocalConfig,
} from '../../project-config-store.js';
import {
  createDefaultProjectArchiveIndex,
  getProjectArchiveFilePath,
  loadProjectArchiveIndex,
  normalizeProjectArchiveIndex,
  saveProjectArchiveIndex,
} from './project-archive-store.js';

export {
  createDefaultProjectArchiveIndex,
  getProjectArchiveFilePath,
  loadProjectArchiveIndex,
  saveProjectArchiveIndex,
};

export type LooseRecord = Record<string, any>;

export const PROJECT_CONFIG_SCHEMA_VERSION = 2;
export const MANUAL_SESSION_DRAFTS_KEY = 'manualSessionDrafts';
export const SESSION_SUMMARY_BY_ID_KEY = 'sessionSummaryById';
export const SESSION_WORKFLOW_METADATA_BY_ID_KEY = 'sessionWorkflowMetadataById';
export const SESSION_UI_STATE_BY_PATH_KEY = 'sessionUiStateByPath';
export const SESSION_MODEL_STATE_BY_ID_KEY = 'sessionModelStateById';
export const MANUAL_SESSION_ROUTE_COUNTER_KEY = 'manualSessionRouteCounter';
export const DISPLAY_NAME_BY_PATH_KEY = 'displayNameByPath';
export const SESSION_ORIGIN_MANUAL = 'manual';
export const SESSION_ORIGIN_WORKFLOW = 'workflow';

/**
 * Return true for plain objects that can safely hold project config state.
 */
export function isPlainRecord(value: unknown): value is LooseRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalize a filesystem path for stable project identity comparisons.
 */
export function normalizeProjectPath(projectPath = ''): string {
  return path.resolve(String(projectPath || '').trim() || path.sep);
}

/**
 * Convert a project path into the user-visible route path.
 */
export function buildProjectRoutePath(projectPath = ''): string {
  const normalized = normalizeProjectPath(projectPath);
  const home = normalizeProjectPath(os.homedir());
  if (home && (normalized === home || normalized.startsWith(`${home}${path.sep}`))) {
    const relative = normalized.slice(home.length).replace(/^[/\\]+/g, '');
    return relative ? `/${relative}` : '/~';
  }
  return normalized;
}

/**
 * Parse a manual cN route id into its numeric route index.
 */
export function parseManualSessionRouteIndex(sessionId = ''): number | null {
  const match = String(sessionId || '').match(/^c(\d+)$/);
  if (!match) {
    return null;
  }
  const routeIndex = Number(match[1]);
  return Number.isInteger(routeIndex) && routeIndex > 0 ? routeIndex : null;
}

/**
 * Build the public cN route id for a numeric route index.
 */
export function buildManualSessionId(routeIndex: number): string {
  if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
    throw new Error('Manual session route index must be a positive integer');
  }
  return `c${routeIndex}`;
}

/**
 * Return a config object normalized enough for current project-domain flows.
 */
export function normalizeProjectConfig(rawConfig: unknown): LooseRecord {
  const config = isPlainRecord(rawConfig) ? { ...rawConfig } : {};
  config.schemaVersion = PROJECT_CONFIG_SCHEMA_VERSION;
  if (isPlainRecord(config.chat)) {
    config.chat = { ...config.chat };
  } else {
    delete config.chat;
  }
  mergeLegacySessionStateIntoChat(config);
  delete config[MANUAL_SESSION_DRAFTS_KEY];
  delete config[SESSION_UI_STATE_BY_PATH_KEY];
  delete config[SESSION_MODEL_STATE_BY_ID_KEY];
  delete config[SESSION_WORKFLOW_METADATA_BY_ID_KEY];
  if (isPlainRecord(config.chat) && Object.keys(config.chat).length === 0) {
    delete config.chat;
  }
  return config;
}

/**
 * Load the persisted project configuration for a project path.
 */
export async function loadProjectConfig(projectPath = ''): Promise<LooseRecord> {
  const { config } = await readProjectLocalConfigFile(projectPath);
  return normalizeProjectConfig(config);
}

/**
 * Persist the current-schema project configuration.
 */
export async function saveProjectConfig(config: LooseRecord = {}, projectPath = ''): Promise<void> {
  await writeProjectLocalConfig(projectPath, normalizeProjectConfig(config));
}

/**
 * Read the map of manual cN drafts from config.
 */
export function getManualSessionDraftMap(config: LooseRecord): LooseRecord {
  return isPlainRecord(config?.[MANUAL_SESSION_DRAFTS_KEY])
    ? config[MANUAL_SESSION_DRAFTS_KEY]
    : {};
}

/**
 * Read workflow ownership metadata from config.
 */
export function getSessionWorkflowMetadataMap(config: LooseRecord): LooseRecord {
  return isPlainRecord(config?.[SESSION_WORKFLOW_METADATA_BY_ID_KEY])
    ? config[SESSION_WORKFLOW_METADATA_BY_ID_KEY]
    : {};
}

/**
 * Build a project chat config record for one visible route.
 */
export function buildProjectChatRecord(
  sessionId: string,
  title: string,
  modelState: LooseRecord = {},
  uiState: LooseRecord = {},
  metadata: LooseRecord = {},
): LooseRecord {
  const record: LooseRecord = {
    sessionId,
    title: String(title || sessionId || 'New Session'),
  };
  if (typeof metadata.provider === 'string') {
    record.provider = metadata.provider;
  }
  if (typeof metadata.providerSessionId === 'string') {
    record.providerSessionId = metadata.providerSessionId;
  }
  if (typeof metadata.workflowId === 'string') {
    record.workflowId = metadata.workflowId;
    record.origin = SESSION_ORIGIN_WORKFLOW;
  } else if (metadata.origin === SESSION_ORIGIN_MANUAL) {
    record.origin = SESSION_ORIGIN_MANUAL;
  }
  if (typeof metadata.stageKey === 'string') {
    record.stageKey = metadata.stageKey;
  }
  Object.assign(record, normalizeSessionModelState(modelState));
  const normalizedUi = normalizeSessionUiState(uiState);
  if (Object.keys(normalizedUi).length > 0) {
    record.ui = normalizedUi;
  }
  return record;
}

/**
 * Find a chat record and its owning config bucket for a session id.
 */
export function findProjectChatRecord(config: LooseRecord = {}, sessionId = '', provider: string | null = null): LooseRecord | null {
  const target = String(sessionId || '').trim();
  if (!target) {
    return null;
  }
  const providerMatches = (record: LooseRecord) => !provider || !record.provider || record.provider === provider;
  const matches = (record: LooseRecord, routeIndex: string) => {
    const numericRouteIndex = Number(routeIndex);
    const routeSessionId = Number.isInteger(numericRouteIndex) && numericRouteIndex > 0
      ? buildManualSessionId(numericRouteIndex)
      : '';
    return providerMatches(record)
      && (record.sessionId === target || record.providerSessionId === target || routeSessionId === target);
  };
  for (const [routeIndex, record] of Object.entries(isPlainRecord(config.chat) ? config.chat : {})) {
    if (isPlainRecord(record) && matches(record, routeIndex)) {
      return { scope: 'chat', routeIndex, record };
    }
  }
  return null;
}

/**
 * Read model-state metadata for a provider session.
 */
export async function getSessionModelState(projectPath = '', sessionId = ''): Promise<LooseRecord> {
  const config = await loadProjectConfig(projectPath);
  const modelState = isPlainRecord(config[SESSION_MODEL_STATE_BY_ID_KEY])
    ? config[SESSION_MODEL_STATE_BY_ID_KEY][sessionId]
    : null;
  return normalizeSessionModelState(modelState);
}

/**
 * Persist model-state metadata for a provider session.
 */
export async function updateSessionModelState(projectPath = '', sessionId = '', patch: LooseRecord = {}): Promise<LooseRecord> {
  if (!sessionId) {
    throw new Error('Session id is required');
  }
  const config = await loadProjectConfig(projectPath);
  const record = findProjectChatRecord(config, sessionId);
  const nextState = {
    ...normalizeSessionModelState(record?.record || {}),
    ...normalizeSessionModelState(patch),
  };
  if (record?.scope === 'chat') {
    config.chat[record.routeIndex] = {
      ...record.record,
      ...nextState,
    };
  } else {
    const allState = isPlainRecord(config[SESSION_MODEL_STATE_BY_ID_KEY])
      ? { ...config[SESSION_MODEL_STATE_BY_ID_KEY] }
      : {};
    allState[sessionId] = { ...nextState, updatedAt: new Date().toISOString() };
    config[SESSION_MODEL_STATE_BY_ID_KEY] = allState;
  }
  await saveProjectConfig(config, projectPath);
  return nextState;
}

/**
 * Persist UI state metadata for a provider session.
 */
export async function updateSessionUiState(
  projectName = '',
  sessionId = '',
  provider = 'codex',
  uiState: LooseRecord = {},
  projectPathOverride = '',
): Promise<LooseRecord> {
  const projectPath = projectPathOverride || await resolveProjectPathForConfigName(projectName);
  const config = await loadProjectConfig(projectPath);
  const normalizedProvider = provider || 'codex';
  const nextUi = normalizeSessionUiState(uiState);
  const record = findProjectChatRecord(config, sessionId, normalizedProvider);
  if (record?.scope === 'chat') {
    config.chat[record.routeIndex] = {
      ...record.record,
      provider: record.record.provider || normalizedProvider,
      ui: nextUi,
    };
  } else {
    const key = `${normalizedProvider}:${normalizeProjectPath(projectPath)}:${sessionId}`;
    const allState = isPlainRecord(config[SESSION_UI_STATE_BY_PATH_KEY])
      ? { ...config[SESSION_UI_STATE_BY_PATH_KEY] }
      : {};
    allState[key] = nextUi;
    config[SESSION_UI_STATE_BY_PATH_KEY] = allState;
  }
  await saveProjectConfig(config, projectPath);
  return nextUi;
}

/**
 * Merge legacy per-session maps into v2 chat route records.
 */
function mergeLegacySessionStateIntoChat(config: LooseRecord): void {
  const chat = isPlainRecord(config.chat) ? config.chat : {};
  const modelStateById = isPlainRecord(config[SESSION_MODEL_STATE_BY_ID_KEY]) ? config[SESSION_MODEL_STATE_BY_ID_KEY] : {};
  const uiStateByPath = isPlainRecord(config[SESSION_UI_STATE_BY_PATH_KEY]) ? config[SESSION_UI_STATE_BY_PATH_KEY] : {};
  for (const [routeIndex, record] of Object.entries(chat)) {
    if (!isPlainRecord(record)) {
      continue;
    }
    const sessionId = String(record.sessionId || '');
    const provider = String(record.provider || 'codex');
    const modelState = normalizeSessionModelState(modelStateById[sessionId]);
    const uiKeySuffix = `:${sessionId}`;
    const uiEntry = Object.entries(uiStateByPath).find(([key]) => key.startsWith(`${provider}:`) && key.endsWith(uiKeySuffix))
      || Object.entries(uiStateByPath).find(([key]) => key.endsWith(uiKeySuffix));
    const uiState = normalizeSessionUiState(uiEntry?.[1]);
    chat[routeIndex] = {
      ...record,
      ...(record.provider ? {} : { provider }),
      ...modelState,
      ...(Object.keys(uiState).length > 0 ? { ui: uiState } : {}),
    };
  }
}

/**
 * Resolve a configured project name back to its project-local config path.
 */
async function resolveProjectPathForConfigName(projectName: string): Promise<string> {
  if (projectName.includes('/') || projectName.startsWith('~')) {
    return projectName;
  }
  const globalConfig = await loadProjectConfig('');
  const configured = globalConfig[projectName];
  return isPlainRecord(configured) && typeof configured.originalPath === 'string'
    ? configured.originalPath
    : projectName;
}

/**
 * Check whether an error means the configured project path is unavailable.
 */
export function isMissingProjectPathError(error: unknown): boolean {
  const nodeError = error as NodeJS.ErrnoException | null;
  return nodeError?.code === 'ENOENT' || nodeError?.code === 'ENOTDIR';
}

/**
 * Validate a project path before adding or using it.
 */
export async function validateProjectPathAvailability(projectPath = '', options: { access?: (path: string) => Promise<void> } = {}) {
  const access = options.access || fs.access;
  if (!projectPath || typeof projectPath !== 'string') {
    return { exists: false, shouldArchive: false, errorCode: 'INVALID_PATH' };
  }
  try {
    await access(projectPath);
    return { exists: true, shouldArchive: false, errorCode: null };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException | null;
    return {
      exists: false,
      shouldArchive: isMissingProjectPathError(error),
      errorCode: nodeError?.code || 'UNKNOWN',
    };
  }
}

/**
 * Evaluate archive state for a project summary.
 */
export async function evaluateProjectArchival(project: LooseRecord = {}) {
  const projectPath = String(project.projectPath || project.fullPath || project.path || '');
  const archiveIndex = normalizeProjectArchiveIndex(project.archiveIndex || {});
  const validation = await validateProjectPathAvailability(projectPath, project.options || {});
  const normalizedPath = projectPath ? normalizeProjectPath(projectPath) : '';
  if (normalizedPath && validation.exists && archiveIndex.archivedProjects[normalizedPath]) {
    delete archiveIndex.archivedProjects[normalizedPath];
    return {
      excludeFromList: false,
      archiveUpdated: true,
      reason: 'archive-cleared-path-exists',
      normalizedPath,
      archiveIndex,
    };
  }
  if (!normalizedPath || validation.exists || !validation.shouldArchive) {
    return {
      excludeFromList: false,
      archiveUpdated: false,
      reason: validation.exists ? 'path-exists' : 'not-archived',
      normalizedPath,
    };
  }
  archiveIndex.archivedProjects[normalizedPath] = {
    normalizedPath,
    path: projectPath,
    source: project.source || 'project',
    reason: 'path-missing',
    archivedAt: project.options?.now instanceof Date ? project.options.now.toISOString() : new Date().toISOString(),
    lastCheckedAt: project.options?.now instanceof Date ? project.options.now.toISOString() : new Date().toISOString(),
    errorCode: validation.errorCode,
  };
  return {
    excludeFromList: true,
    archiveUpdated: true,
    reason: 'archived-missing-path',
    normalizedPath,
    archiveIndex,
  };
}

/**
 * Persist a session summary override in config.
 */
export function writeSessionSummaryOverride(config: LooseRecord, sessionId: string, summary: string): void {
  const summaries = isPlainRecord(config[SESSION_SUMMARY_BY_ID_KEY])
    ? { ...config[SESSION_SUMMARY_BY_ID_KEY] }
    : {};
  summaries[sessionId] = summary;
  config[SESSION_SUMMARY_BY_ID_KEY] = summaries;
}

/**
 * Persist the highest used manual cN route counter.
 */
export function writeManualSessionRouteCounter(config: LooseRecord, _projectPath: string, routeIndex: number): void {
  if (Number.isInteger(routeIndex) && routeIndex > 0) {
    config[MANUAL_SESSION_ROUTE_COUNTER_KEY] = Math.max(Number(config[MANUAL_SESSION_ROUTE_COUNTER_KEY] || 0), routeIndex);
  }
}

/**
 * Return the next manual cN route index for a config.
 */
export function getNextManualRouteIndex(config: LooseRecord): number {
  const chatIndexes = Object.keys(isPlainRecord(config.chat) ? config.chat : {})
    .map((routeIndex) => Number(routeIndex))
    .filter((routeIndex) => Number.isInteger(routeIndex) && routeIndex > 0);
  const draftIndexes = Object.values(getManualSessionDraftMap(config))
    .map((draft) => Number((draft as LooseRecord)?.routeIndex || 0))
    .filter((routeIndex) => Number.isInteger(routeIndex) && routeIndex > 0);
  return Math.max(0, Number(config[MANUAL_SESSION_ROUTE_COUNTER_KEY] || 0), ...chatIndexes, ...draftIndexes) + 1;
}

/**
 * Extract normalized model-related fields from arbitrary input.
 */
function normalizeSessionModelState(value: unknown): LooseRecord {
  const record = isPlainRecord(value) ? value : {};
  const output: LooseRecord = {};
  for (const key of ['model', 'reasoningEffort', 'thinkingMode', 'thinkingLevel', 'updatedAt']) {
    if (typeof record[key] === 'string' && record[key].trim()) {
      output[key] = record[key].trim();
    }
  }
  return output;
}

/**
 * Extract normalized UI-state fields from arbitrary input.
 */
function normalizeSessionUiState(value: unknown): LooseRecord {
  const record = isPlainRecord(value) ? value : {};
  const output: LooseRecord = {};
  for (const key of ['favorite', 'pending', 'hidden']) {
    if (record[key] === true) {
      output[key] = true;
    }
  }
  return output;
}
