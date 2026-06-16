/**
 * PURPOSE: Typed project/session deletion commands for project-local config
 * and provider transcript cleanup.
 */
import { promises as fs } from 'fs';

import {
  findProjectChatRecord,
  loadProjectConfig,
  saveProjectConfig,
} from './project-config-read-model.js';
import {
  clearProjectDirectoryCache,
  extractProjectDirectory,
} from './project-discovery-read-model.js';
import { findCodexSessionFile } from './provider-transcript-read-model.js';
import { db } from '../../database/db.js';
import { projectIndexDb } from '../../project-index-store.js';

/**
 * Delete a session route/config entry by project and session id.
 */
export async function deleteSession(projectName = '', sessionId = '', provider: string | null = null): Promise<boolean> {
  const projectPath = await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(projectPath);
  const record = findProjectChatRecord(config, sessionId, provider);
  if (!record?.record || record.scope !== 'chat') {
    return false;
  }
  delete config.chat[record.routeIndex];
  await saveProjectConfig(config, projectPath);
  clearProjectDirectoryCache();
  return true;
}

/**
 * Delete a Codex transcript file and related project config route.
 */
export async function deleteCodexSession(sessionId: unknown = '', projectPath: unknown = ''): Promise<boolean> {
  const sessionIdText = String(sessionId || '');
  const transcriptPath = await findCodexSessionFile(sessionIdText);
  if (transcriptPath) {
    await fs.rm(transcriptPath, { force: true });
  }
  if (projectPath) {
    const config = await loadProjectConfig(String(projectPath));
    const record = findProjectChatRecord(config, sessionIdText, 'codex');
    if (record?.scope === 'chat') {
      delete config.chat[record.routeIndex];
      await saveProjectConfig(config, String(projectPath));
    }
  }
  clearProjectDirectoryCache();
  return Boolean(transcriptPath);
}

/**
 * Check whether a project has no configured chat routes.
 */
export async function isProjectEmpty(_projectName = '', projectPathHint = ''): Promise<boolean> {
  const config = await loadProjectConfig(projectPathHint);
  return Object.keys(config.chat || {}).length === 0;
}

/**
 * Delete a manually configured project entry when forced.
 */
export async function deleteProject(projectName = '', force = false, projectPathHint = ''): Promise<boolean> {
  if (!force) {
    throw new Error('Project deletion requires force=true');
  }
  const projectPath = projectPathHint || await extractProjectDirectory(projectName);
  const globalConfig = await loadProjectConfig();
  delete globalConfig[projectName];
  await saveProjectConfig(globalConfig);
  if (projectPath) {
    await saveProjectConfig({}, projectPath);
    projectIndexDb.delete(db, projectPath);
  }
  clearProjectDirectoryCache();
  return true;
}
