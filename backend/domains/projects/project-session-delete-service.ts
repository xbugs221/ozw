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
  getProjects,
} from './project-discovery-read-model.js';
import { findCodexSessionFile, findPiSessionFile } from './provider-transcript-read-model.js';
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
    throw new Error('Codex session file not found');
  }
  const providerName = String(provider || record.record.provider || 'codex');
  const providerSessionId = String(record.record.providerSessionId || record.record.sessionId || sessionId);
  delete config.chat[record.routeIndex];
  for (const [routeIndex, chatRecord] of Object.entries(config.chat || {})) {
    if (String((chatRecord as any)?.sessionId || '') === providerSessionId) {
      delete config.chat[routeIndex];
    }
  }
  if (Object.keys(config.chat || {}).length === 0) {
    delete config.chat;
  }
  const drafts = config.manualSessionDrafts && typeof config.manualSessionDrafts === 'object' ? config.manualSessionDrafts : null;
  if (drafts) {
    delete drafts[sessionId];
    if (Object.keys(drafts).length === 0) {
      delete config.manualSessionDrafts;
    }
  }
  await saveProjectConfig(config, projectPath);
  const transcriptPath = providerName === 'pi'
    ? await findPiSessionFile(providerSessionId)
    : await findCodexSessionFile(providerSessionId);
  if (transcriptPath) {
    await fs.rm(transcriptPath, { force: true });
  }
  clearProjectDirectoryCache();
  return true;
}

/**
 * Delete a Codex transcript file and related project config route.
 */
export async function deleteCodexSession(sessionId: unknown = '', projectPath: unknown = ''): Promise<boolean> {
  const sessionIdText = String(sessionId || '');
  const transcriptPath = await findCodexSessionFile(sessionIdText);
  let removedRoute = false;
  if (projectPath) {
    const config = await loadProjectConfig(String(projectPath));
    const record = findProjectChatRecord(config, sessionIdText, 'codex');
    if (record?.scope === 'chat') {
      delete config.chat[record.routeIndex];
      if (Object.keys(config.chat || {}).length === 0) {
        delete config.chat;
      }
      await saveProjectConfig(config, String(projectPath));
      removedRoute = true;
    }
  }
  if (!transcriptPath) {
    if (projectPath) {
      clearProjectDirectoryCache();
      return removedRoute;
    }
    throw new Error('Codex session file not found');
  }
  await fs.rm(transcriptPath, { force: true });
  clearProjectDirectoryCache();
  return Boolean(transcriptPath);
}

/**
 * Check whether a project has no configured chat routes.
 */
export async function isProjectEmpty(_projectName = '', projectPathHint = ''): Promise<boolean> {
  const projectPath = projectPathHint || await extractProjectDirectory(_projectName);
  const config = await loadProjectConfig(projectPath);
  if (Object.keys(config.chat || {}).length > 0) {
    return false;
  }
  const projects = await getProjects(null, { lightweightList: true });
  return !projects.some((project) => String(project.fullPath || project.path || '') === projectPath);
}

/**
 * Delete a manually configured project entry when forced.
 */
export async function deleteProject(projectName = '', force = false, projectPathHint = ''): Promise<boolean> {
  if (!force && !await isProjectEmpty(projectName, projectPathHint)) {
    throw new Error('Cannot delete project with existing sessions');
  }
  if (!force) {
    throw new Error('Project deletion requires force=true');
  }
  const projectPath = projectPathHint || await resolveProjectPathForDelete(projectName);
  const codexFiles = await Promise.all((await findProviderSessionFilesForProject('codex', projectPath)).map((filePath) => fs.rm(filePath, { force: true })));
  await Promise.all(codexFiles);
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

/**
 * Resolve synthetic provider-only names back to their real project path.
 */
async function resolveProjectPathForDelete(projectName: string): Promise<string> {
  const projects = await getProjects(null, { lightweightList: true });
  const matchedProject = projects.find((project) => String(project.name || '') === projectName);
  return String(matchedProject?.fullPath || matchedProject?.path || '') || await extractProjectDirectory(projectName);
}

/**
 * Find provider transcript files that belong to a project before deleting it.
 */
async function findProviderSessionFilesForProject(provider: 'codex', projectPath: string): Promise<string[]> {
  const { listCodexSessionFiles, parseCodexSessionHeader } = await import('./provider-transcript-read-model.js');
  const files = provider === 'codex' ? await listCodexSessionFiles() : [];
  const matched: string[] = [];
  for (const filePath of files) {
    const header = await parseCodexSessionHeader(filePath);
    if (header && String(header.projectPath || header.cwd || '') === projectPath) {
      matched.push(filePath);
    }
  }
  return matched;
}
