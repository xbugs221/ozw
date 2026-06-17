/**
 * PURPOSE: Typed project/session rename commands backed by project config.
 */
import {
  DISPLAY_NAME_BY_PATH_KEY,
  findProjectChatRecord,
  isPlainRecord,
  loadProjectConfig,
  normalizeProjectPath,
  saveProjectConfig,
  writeSessionSummaryOverride,
  type LooseRecord,
} from './project-config-read-model.js';
import {
  clearProjectDirectoryCache,
  extractProjectDirectory,
} from './project-discovery-read-model.js';
import { db } from '../../database/db.js';
import { projectIndexDb } from '../../project-index-store.js';

/**
 * Rename a project display name without changing its identity key.
 */
export async function renameProject(projectName = '', newDisplayName = '', projectPath: string | null = null): Promise<LooseRecord> {
  const resolvedPath = normalizeProjectPath(projectPath || await extractProjectDirectory(projectName));
  const config = await loadProjectConfig();
  const displayNameByPath = isPlainRecord(config[DISPLAY_NAME_BY_PATH_KEY])
    ? { ...config[DISPLAY_NAME_BY_PATH_KEY] }
    : {};
  const trimmedName = String(newDisplayName || '').trim();
  if (trimmedName) {
    displayNameByPath[resolvedPath] = trimmedName;
  } else {
    delete displayNameByPath[resolvedPath];
  }
  config[DISPLAY_NAME_BY_PATH_KEY] = displayNameByPath;
  await saveProjectConfig(config);
  projectIndexDb.updateDisplayName(db, resolvedPath, trimmedName || null);
  clearProjectDirectoryCache();
  return { projectName, projectPath: resolvedPath, displayName: trimmedName || null };
}

/**
 * Rename a session summary in project-local config.
 */
export async function renameSession(projectName = '', sessionId = '', newSummary = '', projectPath = ''): Promise<LooseRecord> {
  const resolvedPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedPath);
  const record = findProjectChatRecord(config, sessionId);
  const trimmedSummary = String(newSummary || '').trim();
  if (!trimmedSummary) {
    throw new Error('Session summary is required');
  }
  if (!record?.record) {
    throw new Error('Claude sessions are no longer supported');
  }
  if (record?.record && record.scope === 'chat') {
    config.chat[record.routeIndex] = {
      ...record.record,
      title: trimmedSummary,
      summary: trimmedSummary,
    };
  }
  writeSessionSummaryOverride(config, sessionId, trimmedSummary);
  await saveProjectConfig(config, resolvedPath);
  clearProjectDirectoryCache();
  return { projectName, projectPath: resolvedPath, sessionId, summary: trimmedSummary };
}

/**
 * Rename a Codex session summary by delegating to generic session config.
 */
export function renameCodexSession(sessionId: unknown = '', newSummary: unknown = '', projectPath: unknown = '') {
  return renameSession(String(projectPath || ''), String(sessionId || ''), String(newSummary || ''), String(projectPath || ''));
}
