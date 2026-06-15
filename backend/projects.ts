// @ts-nocheck -- Migration baseline: JS-to-TS rename complete. Types will be tightened incrementally.
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';
import os from 'os';
import { getActiveCodexSessions } from './openai-codex.js';
import { getCodexSessionTokenUsageFromFile } from './session-token-usage.js';
import { listProjectWorkflows } from './workflows.js';
import { getProjectLocalConfigPath as resolveProjectLocalConfigPath, readProjectLocalConfig, readProjectLocalConfigFile, writeProjectLocalConfig, } from './project-config-store.js';
import { normalizeCodexFileOperationPayload, normalizeCodexFunctionCall, normalizeCodexRealtimeItem, normalizeCodexToolOutput, } from '../shared/codex-message-normalizer.js';
import { configureProviderSessionReadModel, deleteProviderSessionIndexFile, indexProviderSessionFile, listIndexedProviderSessionsForProject, upsertProviderSessionIndex, } from './domains/projects/provider-session-read-model.js';
import { buildProviderSessionListReadModel } from './domains/projects/provider-session-list-read-model.js';
import { createDefaultProjectArchiveIndex, getProjectArchiveFilePath, loadProjectArchiveIndex, normalizeProjectArchiveIndex, saveProjectArchiveIndex, } from './domains/projects/project-archive-store.js';
import { bindManualSessionProvider as bindManualSessionProviderInStore, finalizeManualSessionRoute as finalizeManualSessionRouteInStore, initManualSessionRoute as initManualSessionRouteInStore, } from './domains/projects/session-route-store.js';
const projectDirectoryCache = new Map();
const PROJECT_DISPLAY_NAME_BY_PATH_KEY = 'displayNameByPath';
const MANUAL_SESSION_DRAFTS_KEY = 'manualSessionDrafts';
const SESSION_SUMMARY_BY_ID_KEY = 'sessionSummaryById';
const LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY = 'sessionSummaryOverrideById';
const LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY = 'codexSessionSummaryById';
const SESSION_WORKFLOW_METADATA_BY_ID_KEY = 'sessionWorkflowMetadataById';
const SESSION_UI_STATE_BY_PATH_KEY = 'sessionUiStateByPath';
const SESSION_MODEL_STATE_BY_ID_KEY = 'sessionModelStateById';
const SESSION_ROUTE_INDEX_KEY = 'sessionRouteIndex';
const LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY = 'sessionRouteIndexByPath';
const MANUAL_SESSION_ROUTE_COUNTER_KEY = 'manualSessionRouteCounter';
const LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY = 'manualSessionRouteCounterByPath';
const HYDRATED_MANUAL_SESSION_DRAFT_IDS = Symbol('hydratedManualSessionDraftIds');
const PROJECT_CONFIG_SCHEMA_VERSION = 2;
const SESSION_ORIGIN_MANUAL = 'manual';
const SESSION_ORIGIN_WORKFLOW = 'workflow';
const sessionPathExistenceCache = new Map();
const codexSessionFileCache = new Map();
const jsonlLineCursorByteOffsetCache = new Map();
let codexSessionsIndexCache = null;
let codexSessionsIndexPromise = null;
let codexSessionsIndexPromiseKey = '';
let piSessionsIndexCache = null;
let piSessionsIndexPromise = null;
let piSessionsIndexPromiseKey = '';
let projectsSnapshotCache = null;
let projectsSnapshotPromise = null;
const SESSION_PATH_CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(process.env.SESSION_PATH_CACHE_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60 * 1000;
})();
const CODEX_INDEX_CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(process.env.CODEX_INDEX_CACHE_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30 * 1000;
})();
const PI_INDEX_CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(process.env.PI_INDEX_CACHE_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30 * 1000;
})();
const PROJECTS_CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(process.env.PROJECTS_CACHE_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5 * 1000;
})();
const PROJECT_OVERVIEW_SESSION_LIMIT = 10;
const PROJECT_OVERVIEW_PROVIDER_FILE_LIMIT = (() => {
  const parsed = Number.parseInt(process.env.PROJECT_OVERVIEW_PROVIDER_FILE_LIMIT || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
})();
const PROVIDER_INDEX_HOME_BUDGET_MS = (() => {
  const parsed = Number.parseInt(process.env.PROVIDER_INDEX_HOME_BUDGET_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2500;
})();
const PROVIDER_ONLY_PROJECT_LIMIT = 50;
const LIGHTWEIGHT_PROVIDER_PROJECT_FILE_LIMIT = PROVIDER_ONLY_PROJECT_LIMIT * 4;
const AUTO_IMPORTED_ROUTE_TITLE_SOURCE = 'auto-import';
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
  projectsSnapshotCache = null;
  projectsSnapshotPromise = null;
  codexSessionsIndexCache = null;
  codexSessionsIndexPromise = null;
  codexSessionsIndexPromiseKey = '';
  piSessionsIndexCache = null;
  piSessionsIndexPromise = null;
  piSessionsIndexPromiseKey = '';
  codexSessionFileCache.clear();
  jsonlLineCursorByteOffsetCache.clear();
}
function clearSessionPathExistenceCache() {
  sessionPathExistenceCache.clear();
}
function cloneProjectsSnapshot(projects) {
  return JSON.parse(JSON.stringify(Array.isArray(projects) ? projects : []));
}
function rememberJsonlLineCursor(filePath, lineCount, byteOffset, fileSize) {
    const cursor = Math.max(0, Number(lineCount) || 0);
  const offset = Math.max(0, Number(byteOffset) || 0);
  jsonlLineCursorByteOffsetCache.set(`${filePath}:${cursor}`, {
    byteOffset: offset,
    fileSize: Math.max(offset, Number(fileSize) || offset),
  });
}
function getCachedJsonlLineCursor(filePath, lineCount, fileSize) {
    const cursor = Math.max(0, Number(lineCount) || 0);
  const cached = jsonlLineCursorByteOffsetCache.get(`${filePath}:${cursor}`);
  if (!cached || cached.byteOffset > fileSize || cached.fileSize > fileSize) {
    return null;
  }
  return cached.byteOffset;
}
async function readJsonlTailWindow(filePath, limit, offset = 0) {
  const chunkSize = 64 * 1024;
  const desiredCount = Math.max(0, limit + offset);
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const { size } = await fileHandle.stat();
    if (size === 0) {
      return { lines: [], total: 0 };
    }
    let position = size;
    let remainder = '';
    let total = 0;
    const newestFirstLines = [];
        const recordLine = (line) => {
      if (!line || !line.trim()) {
        return;
      }
      total += 1;
      if (newestFirstLines.length < desiredCount) {
        newestFirstLines.push({
          line,
          reverseIndex: total - 1,
        });
      }
    };
    while (position > 0) {
      const start = Math.max(0, position - chunkSize);
      const length = position - start;
      const buffer = Buffer.alloc(length);
      await fileHandle.read(buffer, 0, length, start);
      const combined = buffer.toString('utf8') + remainder;
      const parts = combined.split('\n');
      remainder = parts.shift() || '';
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        recordLine(parts[index]);
      }
      position = start;
    }
    recordLine(remainder);
    const newestWindow = newestFirstLines
      .slice(offset, offset + limit)
      .map((entry) => ({
        line: entry.line,
        lineNumber: total - entry.reverseIndex,
      }));
    rememberJsonlLineCursor(filePath, total, size, size);
    return {
      lines: newestWindow.reverse(),
      total,
    };
  } finally {
    await fileHandle.close();
  }
}
async function readJsonlAfterLine(filePath, afterLine) {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const { size } = await fileHandle.stat();
    if (size === 0) {
      return { lines: [], total: 0 };
    }
    const cursor = Math.max(0, Number(afterLine) || 0);
    const decoder = new TextDecoder('utf8');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const cachedStartOffset = cursor > 0 ? getCachedJsonlLineCursor(filePath, cursor, size) : 0;
    let position = cachedStartOffset ?? 0;
    let remainder = '';
    let total = cachedStartOffset === null ? 0 : cursor;
    const newLines = [];
    const recordLine = (line) => {
            if (!line.trim()) {
        return;
      }
      total += 1;
      if (total > cursor) {
        newLines.push({ line, lineNumber: total });
      }
    };
    while (position < size) {
      const { bytesRead } = await fileHandle.read(buffer, 0, Math.min(buffer.length, size - position), position);
      if (bytesRead === 0) {
        break;
      }
      position += bytesRead;
      const chunk = decoder.decode(buffer.subarray(0, bytesRead), { stream: position < size });
      const parts = `${remainder}${chunk}`.split('\n');
      remainder = parts.pop() || '';
      for (const line of parts) {
        recordLine(line);
      }
    }
    const finalChunk = decoder.decode();
    if (finalChunk) {
      remainder += finalChunk;
    }
    recordLine(remainder);
    rememberJsonlLineCursor(filePath, total, size, size);
    return { lines: newLines, total };
  } finally {
    await fileHandle.close();
  }
}
function buildCodexMessageKey(sessionId, lineNumber, subIndex = 0) {
  return `codex:${sessionId}:line:${lineNumber}:msg:${subIndex}`;
}
function encodeProjectPathAsName(projectPath) {
  return String(projectPath || '').replace(/\//g, '-');
}
function normalizeSearchableText(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSearchableText(item?.text ?? item?.content ?? item))
      .filter(Boolean)
      .join('\n');
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text;
    }
    if (typeof value.content === 'string') {
      return value.content;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value == null ? '' : String(value);
}
function buildSearchSnippet(text, query) {
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalizedText) {
    return '';
  }
  const lowerText = normalizedText.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const hitIndex = lowerText.indexOf(lowerQuery);
  if (hitIndex < 0) {
    return normalizedText.slice(0, 160);
  }
  const start = Math.max(0, hitIndex - 48);
  const end = Math.min(normalizedText.length, hitIndex + query.length + 72);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';
  return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
}
function matchesSearchQuery(text, query) {
  if (!text || !query) {
    return false;
  }
  return text.toLowerCase().includes(query.toLowerCase());
}
function deriveCodexThreadFromJsonlPath(filePath) {
  const sessionFileName = path.basename(String(filePath || ''));
  const rolloutMatch = sessionFileName.match(
    /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/,
  );
  const fallbackThread = sessionFileName.endsWith('.jsonl')
    ? sessionFileName.slice(0, -'.jsonl'.length)
    : sessionFileName;
  return {
    thread: rolloutMatch?.[1] || fallbackThread,
    sessionFileName,
  };
}
async function findCodexSessionFilePath(sessionId) {
  const cachedPath = codexSessionFileCache.get(sessionId);
  if (cachedPath) {
    try {
      await fs.access(cachedPath);
      return cachedPath;
    } catch {
      codexSessionFileCache.delete(sessionId);
    }
  }
  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
    const walk = async (dir) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = await walk(fullPath);
          if (found) {
            return found;
          }
        } else if (entry.name.includes(sessionId) && entry.name.endsWith('.jsonl')) {
          return fullPath;
        }
      }
    } catch {
    }
    return null;
  };
  const resolvedPath = await walk(codexSessionsDir);
  if (resolvedPath) {
    codexSessionFileCache.set(sessionId, resolvedPath);
  }
  return resolvedPath;
}
async function listCodexSessionFiles(rootDir = path.join(os.homedir(), '.codex', 'sessions')) {
  const discoveredFiles = [];
    const walk = async (dir) => {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        discoveredFiles.push(fullPath);
      }
    }
  };
  await walk(rootDir);
  return discoveredFiles;
}
async function readJsonlFirstRecord(filePath) {
  const fileStream = fsSync.createReadStream(filePath, {
    encoding: 'utf8',
    highWaterMark: 16 * 1024,
  });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      return JSON.parse(line);
    }
    return null;
  } finally {
    rl.close();
    fileStream.destroy();
  }
}
async function walkJsonlLinesInReverse(filePath, visitLine) {
  const chunkSize = 64 * 1024;
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const { size } = await fileHandle.stat();
    if (size === 0) {
      return;
    }
    let position = size;
    let remainder = '';
    const emitLine = async (line) => {
      if (!line || !line.trim()) {
        return true;
      }
      const shouldContinue = await visitLine(line);
      return shouldContinue !== false;
    };
    while (position > 0) {
      const start = Math.max(0, position - chunkSize);
      const length = position - start;
      const buffer = Buffer.alloc(length);
      await fileHandle.read(buffer, 0, length, start);
      const combined = buffer.toString('utf8') + remainder;
      const parts = combined.split('\n');
      remainder = parts.shift() || '';
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const shouldContinue = await emitLine(parts[index]);
        if (!shouldContinue) {
          return;
        }
      }
      position = start;
    }
    await emitLine(remainder);
  } finally {
    await fileHandle.close();
  }
}
function createLiveProjectName(projectPath, usedProjectNames, provider) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  let baseProjectName = projectPath.replace(/[\\/:\s~_]/g, '-');
  if (!baseProjectName) {
    baseProjectName = `${provider}-${crypto.createHash('md5').update(normalizedProjectPath || projectPath).digest('hex').slice(0, 12)}`;
  }
  let projectName = baseProjectName;
  if (usedProjectNames.has(projectName)) {
    const suffix = crypto.createHash('md5').update(normalizedProjectPath || projectPath).digest('hex').slice(0, 8);
    projectName = `${baseProjectName}-${provider}-${suffix}`;
  }
  while (usedProjectNames.has(projectName)) {
    projectName = `${projectName}-1`;
  }
  return projectName;
}
async function resolveProviderIndexWithinHomeBudget(label, indexPromise, cache) {
  const startedAt = Date.now();
  let budgetTimer = null;
  const budgetExceeded = new Promise((resolve) => {
    budgetTimer = setTimeout(() => {
      console.warn(`[Projects] ${label} index exceeded ${PROVIDER_INDEX_HOME_BUDGET_MS}ms; returning degraded home overview`);
      resolve(cache?.value || new Map());
    }, PROVIDER_INDEX_HOME_BUDGET_MS);
  });
  const guardedIndex = indexPromise
    .then((index) => {
      console.info(`[Projects] ${label} index ready in ${Date.now() - startedAt}ms`);
      return index;
    })
    .catch((error) => {
      console.warn(`[Projects] ${label} index failed; returning degraded home overview:`, error.message);
      return cache?.value || new Map();
    });
  try {
    return await Promise.race([guardedIndex, budgetExceeded]);
  } finally {
    if (budgetTimer) {
      clearTimeout(budgetTimer);
    }
  }
}
async function hydrateProviderIndexesForHomeOverview(refs) {
  const [codexSessionsByProject, piSessionsByProject] = await Promise.all([
    resolveProviderIndexWithinHomeBudget(
      'Codex',
      getCachedCodexSessionsIndex(),
      codexSessionsIndexCache,
    ),
    resolveProviderIndexWithinHomeBudget(
      'Pi',
      getCachedPiSessionsIndex(),
      piSessionsIndexCache,
    ),
  ]);
  refs.codex.sessionsByProject = codexSessionsByProject;
  refs.pi.sessionsByProject = piSessionsByProject;
}
function collectProviderProjectCandidatesFromIndex(provider, sessionsByProject) {
    if (!(sessionsByProject instanceof Map)) {
    return [];
  }
  return [...sessionsByProject.entries()]
    .map(([normalizedProjectPath, providerSessions]) => ({
      provider,
      normalizedProjectPath,
      providerSessions,
      lastActivity: providerSessions
        .map((session) => new Date(session?.lastActivity || session?.updated_at || session?.createdAt || 0).getTime())
        .filter(Number.isFinite)
        .sort((left, right) => right - left)[0] || 0,
    }))
    .filter((candidate) => candidate.normalizedProjectPath);
}
async function listDirectoryEntriesByRecency(dir) {
    let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const entriesWithStats = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      return { entry, fullPath, mtimeMs: stat.mtimeMs || 0 };
    } catch {
      return { entry, fullPath, mtimeMs: 0 };
    }
  }));
  return entriesWithStats.sort((left, right) => {
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return String(right.entry.name).localeCompare(String(left.entry.name));
  });
}
async function listRecentProviderJsonlFiles(rootDir, limit = LIGHTWEIGHT_PROVIDER_PROJECT_FILE_LIMIT) {
    const discoveredFiles = [];
  const walk = async (dir) => {
    if (discoveredFiles.length >= limit) {
      return;
    }
    const entries = await listDirectoryEntriesByRecency(dir);
    for (const { entry, fullPath } of entries) {
      if (discoveredFiles.length >= limit) {
        return;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        discoveredFiles.push(fullPath);
      } else if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  };
  await walk(rootDir);
  return discoveredFiles;
}
async function collectLightweightCodexProjectCandidates() {
    const cachedCandidates = collectProviderProjectCandidatesFromIndex('codex', codexSessionsIndexCache?.value);
  if (cachedCandidates.length > 0) {
    return cachedCandidates;
  }
  const candidatesByPath = new Map();
  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  const recentFiles = await listRecentProviderJsonlFiles(codexSessionsDir);
  for (const filePath of recentFiles) {
    try {
      const header = await parseCodexSessionHeader(filePath);
      const normalizedProjectPath = normalizeComparablePath(header?.cwd);
      if (!normalizedProjectPath || candidatesByPath.has(normalizedProjectPath)) {
        continue;
      }
      candidatesByPath.set(normalizedProjectPath, {
        provider: 'codex',
        normalizedProjectPath,
        providerSessions: [{
          cwd: header.cwd,
          projectPath: header.cwd,
          lastActivity: header.timestamp || header.createdAt,
          createdAt: header.createdAt,
        }],
        lastActivity: new Date(header.timestamp || header.createdAt || 0).getTime() || 0,
      });
    } catch (error) {
      console.warn(`[Projects] Could not read Codex project header ${filePath}:`, error.message);
    }
  }
  return [...candidatesByPath.values()];
}
async function collectLightweightPiProjectCandidates() {
    const cachedCandidates = collectProviderProjectCandidatesFromIndex('pi', piSessionsIndexCache?.value);
  if (cachedCandidates.length > 0) {
    return cachedCandidates;
  }
  const candidatesByPath = new Map();
  const piSessionsDir = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  const recentFiles = await listRecentProviderJsonlFiles(piSessionsDir);
  for (const filePath of recentFiles) {
    try {
      const firstRecord = await readJsonlFirstRecord(filePath);
      const projectPath = firstRecord?.type === 'session' ? firstRecord.cwd : '';
      const normalizedProjectPath = normalizeComparablePath(projectPath);
      if (!normalizedProjectPath || candidatesByPath.has(normalizedProjectPath)) {
        continue;
      }
      const timestamp = firstRecord.timestamp || new Date().toISOString();
      candidatesByPath.set(normalizedProjectPath, {
        provider: 'pi',
        normalizedProjectPath,
        providerSessions: [{
          cwd: projectPath,
          projectPath,
          lastActivity: timestamp,
          createdAt: timestamp,
        }],
        lastActivity: new Date(timestamp).getTime() || 0,
      });
    } catch (error) {
      console.warn(`[Projects] Could not read Pi project header ${filePath}:`, error.message);
    }
  }
  return [...candidatesByPath.values()];
}
async function collectLightweightProviderOnlyCandidates() {
    const [codexCandidates, piCandidates] = await Promise.all([
    collectLightweightCodexProjectCandidates(),
    collectLightweightPiProjectCandidates(),
  ]);
  return [...codexCandidates, ...piCandidates]
    .sort((left, right) => right.lastActivity - left.lastActivity);
}
function createSyntheticActiveSession(session, provider) {
  const startedAt = session.startedAt || new Date().toISOString();
  const summary = provider === 'pi' ? 'Active Pi session' : 'Active Codex session';
  return {
    id: session.id,
    summary,
    createdAt: startedAt,
    lastActivity: startedAt,
    updated_at: startedAt,
    messageCount: null,
    messageCountKnown: false,
    projectPath: session.projectPath || '',
    status: 'active',
  };
}
async function mergeActiveProviderSessionsIntoProjects({
  projects,
  config,
  usedProjectNames,
  knownProjectPaths,
}) {
  const activeProviderSessions = [
    ...getActiveCodexSessions().map((session) => ({ ...session, provider: 'codex' })),
  ];
  for (const session of activeProviderSessions) {
    const normalizedProjectPath = normalizeComparablePath(session.projectPath);
    if (!session.id || !normalizedProjectPath) {
      continue;
    }
    const sessionProjectConfig = await loadProjectConfig(session.projectPath);
    const sessionWorkflowMetadata = getSessionWorkflowMetadataMap(sessionProjectConfig);
    if (sessionWorkflowMetadata[session.id]?.workflowId) {
      continue;
    }
    let project = projects.find(
      (candidate) => normalizeComparablePath(candidate.fullPath || candidate.path) === normalizedProjectPath,
    );
    if (!project) {
      const projectPath = session.projectPath;
      const projectName = createLiveProjectName(projectPath, usedProjectNames, session.provider);
      const autoDisplayName = await generateDisplayName(projectName, projectPath);
      const resolvedDisplayName = resolveProjectDisplayName(
        config,
        projectName,
        projectPath,
        autoDisplayName,
      );
      project = {
        name: projectName,
        path: projectPath,
        routePath: buildProjectRoutePath(projectPath),
        displayName: resolvedDisplayName.displayName,
        fullPath: projectPath,
        isCustomName: resolvedDisplayName.isCustomName,
        sessions: [],
        codexSessions: [],
        piSessions: [],
        sessionMeta: {
          hasMore: false,
          total: 0,
        },
      };
      projects.push(project);
      usedProjectNames.add(projectName);
      knownProjectPaths.add(normalizedProjectPath);
    }
    const targetKey = session.provider === 'codex' ? 'codexSessions' : session.provider === 'pi' ? 'piSessions' : 'sessions';
    const targetSessions = Array.isArray(project[targetKey]) ? project[targetKey] : [];
    if (targetSessions.some((existingSession) => existingSession.id === session.id)) {
      continue;
    }
    project[targetKey] = [createSyntheticActiveSession(session, session.provider), ...targetSessions];
    if (session.provider === 'claude') {
      const currentTotal = Number(project.sessionMeta?.total || 0);
      project.sessionMeta = {
        ...project.sessionMeta,
        total: currentTotal + 1,
      };
    }
  }
}
function resolveSessionProjectPath(session, fallbackProjectPath = '') {
  if (session?.cwd && typeof session.cwd === 'string' && session.cwd.trim()) {
    return session.cwd.trim();
  }
  if (session?.projectPath && typeof session.projectPath === 'string' && session.projectPath.trim()) {
    return session.projectPath.trim();
  }
  if (typeof fallbackProjectPath === 'string' && fallbackProjectPath.trim()) {
    return fallbackProjectPath.trim();
  }
  return '';
}
async function projectPathExists(projectPath, options = {}) {
  const { forceRefresh = false } = options;
  const normalizedPath = normalizeComparablePath(projectPath);
  if (!normalizedPath) {
    return false;
  }
  const now = Date.now();
  const cached = sessionPathExistenceCache.get(normalizedPath);
  if (
    !forceRefresh &&
    cached &&
    now - cached.checkedAt < SESSION_PATH_CACHE_TTL_MS
  ) {
    return cached.exists;
  }
  let exists = false;
  try {
    await fs.access(normalizedPath);
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[SessionVisibility] Failed to check project path: ${normalizedPath}`, error.message);
    }
  }
  sessionPathExistenceCache.set(normalizedPath, {
    exists,
    checkedAt: now
  });
  return exists;
}
async function annotateSessionVisibility(session, fallbackProjectPath = '') {
  const sessionProjectPath = resolveSessionProjectPath(session, fallbackProjectPath);
  if (!sessionProjectPath) {
    return {
      ...session,
      projectPath: fallbackProjectPath || session.projectPath || '',
      projectPathExists: true
    };
  }
  if (
    fallbackProjectPath
    && normalizeComparablePath(sessionProjectPath) === normalizeComparablePath(fallbackProjectPath)
  ) {
    return {
      ...session,
      projectPath: fallbackProjectPath,
      projectPathExists: true
    };
  }
  const exists = await projectPathExists(sessionProjectPath);
  if (exists) {
    return {
      ...session,
      projectPath: sessionProjectPath,
      projectPathExists: true
    };
  }
  return {
    ...session,
    status: session.status === 'hidden' ? 'hidden' : 'archived',
    archived: true,
    hidden: true,
    visibilityReason: 'missing_project_path',
    projectPath: sessionProjectPath,
    projectPathExists: false
  };
}
async function annotateSessionCollectionVisibility(sessions, fallbackProjectPath = '') {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [];
  }
  return Promise.all(
    sessions.map((session) => annotateSessionVisibility(session, fallbackProjectPath))
  );
}
function isSessionVisibleByDefault(session) {
  return !(
    session?.hidden === true ||
    session?.archived === true ||
    session?.status === 'archived' ||
    session?.status === 'hidden'
  );
}
function filterHiddenArchivedSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [];
  }
  return sessions.filter(isSessionVisibleByDefault);
}
function getProjectLocalConfigPath(projectPath) {
  return resolveProjectLocalConfigPath(projectPath);
}
async function loadProjectConfig(projectPath = '') {
  try {
    const { config: parsedConfig, exists } = await readProjectLocalConfigFile(projectPath);
    if (!exists) {
      return {};
    }
    const persistedConfig = normalizeProjectConfigForSave(parsedConfig, projectPath);
    await writeProjectLocalConfig(projectPath, persistedConfig);
    return normalizeProjectConfigForRead(persistedConfig, projectPath);
  } catch (error) {
    return {};
  }
}
function normalizeProjectConfigForRead(config, projectPath = '') {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }
  const normalized = normalizeProjectConfigForSave(config, projectPath);
  const hydratedDraftMap = getManualSessionDraftMap(normalized);
  const hydratedDraftIds = Object.keys(hydratedDraftMap);
  if (hydratedDraftIds.length > 0) {
    normalized[MANUAL_SESSION_DRAFTS_KEY] = hydratedDraftMap;
    Object.defineProperty(normalized, HYDRATED_MANUAL_SESSION_DRAFT_IDS, {
      value: new Set(hydratedDraftIds),
      enumerable: false,
      configurable: true,
    });
  }
  return normalized;
}
function buildProjectChatRecord(sessionId, title, modelState = {}, uiState = {}, metadata = {}) {
  const record = { sessionId };
  if (typeof title === 'string' && title.trim()) {
    record.title = title.trim();
  }
  if (typeof metadata.provider === 'string' && metadata.provider.trim()) {
    record.provider = metadata.provider.trim();
  }
  if (typeof metadata.stageKey === 'string' && metadata.stageKey.trim()) {
    record.stageKey = metadata.stageKey.trim();
  }
  if (typeof metadata.workflowId === 'string' && metadata.workflowId.trim()) {
    record.workflowId = metadata.workflowId.trim();
  }
  if (metadata.origin === SESSION_ORIGIN_MANUAL || metadata.origin === SESSION_ORIGIN_WORKFLOW) {
    record.origin = metadata.origin;
  } else if (record.workflowId) {
    record.origin = SESSION_ORIGIN_WORKFLOW;
  }
  if (typeof metadata.summary === 'string' && metadata.summary.trim()) {
    record.summary = metadata.summary.trim();
  }
  if (record.summary && record.summary === record.title) {
    delete record.summary;
  }
  if (typeof metadata.providerSessionId === 'string' && metadata.providerSessionId.trim()) {
    record.providerSessionId = metadata.providerSessionId.trim();
  }
  if (typeof modelState.model === 'string' && modelState.model.trim()) {
    record.model = modelState.model.trim();
  }
  if (typeof modelState.reasoningEffort === 'string' && modelState.reasoningEffort.trim()) {
    record.reasoningEffort = modelState.reasoningEffort.trim();
  }
  if (typeof modelState.thinkingMode === 'string' && modelState.thinkingMode.trim()) {
    record.thinkingMode = modelState.thinkingMode.trim();
  }
  if (typeof modelState.thinkingLevel === 'string' && modelState.thinkingLevel.trim()) {
    record.thinkingLevel = modelState.thinkingLevel.trim();
  }
  if (uiState && typeof uiState === 'object' && !Array.isArray(uiState) && Object.keys(uiState).length > 0) {
    record.ui = { ...uiState };
  }
  return record;
}
function normalizeProjectChatBucket(chat = {}) {
  const seenSessionIds = new Set();
  return Object.entries(chat && typeof chat === 'object' && !Array.isArray(chat) ? chat : {})
    .reduce((bucket, [routeIndex, record]) => {
      const sessionId = typeof record?.sessionId === 'string' ? record.sessionId.trim() : '';
      if (!sessionId || seenSessionIds.has(sessionId)) {
        return bucket;
      }
      seenSessionIds.add(sessionId);
      const nextRecord = {
        ...(record && typeof record === 'object' && !Array.isArray(record) ? record : {}),
        sessionId,
      };
      if (nextRecord.ui && typeof nextRecord.ui === 'object' && !Array.isArray(nextRecord.ui) && Object.keys(nextRecord.ui).length === 0) {
        delete nextRecord.ui;
      }
      if (nextRecord.summary && nextRecord.summary === nextRecord.title) {
        delete nextRecord.summary;
      }
      bucket[routeIndex] = nextRecord;
      return bucket;
    }, {});
}
function normalizeSessionUiState(rawState = {}) {
  const state = {};
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    return state;
  }
  if (rawState.favorite === true) {
    state.favorite = true;
  }
  if (rawState.pending === true) {
    state.pending = true;
  }
  if (rawState.hidden === true) {
    state.hidden = true;
  }
  return state;
}
function normalizeProjectChatProvider(provider) {
  if (provider === 'claude') return 'claude';
  if (provider === 'pi') return 'pi';
  return 'codex';
}
function parseSessionUiStateKey(stateKey) {
  const [provider, ...rest] = String(stateKey || '').split(':');
  const sessionId = rest.pop();
  const projectPath = rest.join(':');
  if (!provider || !projectPath || !sessionId) {
    return null;
  }
  return {
    provider: normalizeProjectChatProvider(provider),
    projectPath,
    sessionId,
  };
}
function findProjectChatRecord(config, sessionId, provider = null) {
  const providerMatches = (record) => {
    if (!provider) {
      return true;
    }
    return !record?.provider || normalizeProjectChatProvider(record.provider) === provider;
  };
  const sessionMatches = (record, routeIndex = null) => {
    if (!sessionId) {
      return false;
    }
    const routeSessionId = Number.isInteger(Number(routeIndex)) && Number(routeIndex) > 0
      ? buildManualSessionId(Number(routeIndex))
      : null;
    return record?.sessionId === sessionId
      || record?.providerSessionId === sessionId
      || routeSessionId === sessionId;
  };
  for (const [routeIndex, record] of Object.entries(config?.chat || {})) {
    if (sessionMatches(record, routeIndex) && providerMatches(record)) {
      return { scope: 'chat', routeIndex, record };
    }
  }
  for (const [workflowIndex, workflow] of Object.entries(config?.workflows || {})) {
    for (const [routeIndex, record] of Object.entries(workflow?.chat || {})) {
      if (sessionMatches(record, routeIndex) && providerMatches(record)) {
        return { scope: 'workflow', workflowIndex, routeIndex, record };
      }
    }
  }
  return null;
}
function writeProjectChatRecordUiState(record, provider, uiState) {
  const nextState = normalizeSessionUiState(uiState);
  if (provider) {
    record.provider = provider;
  }
  if (Object.keys(nextState).length === 0) {
    delete record.ui;
    return;
  }
  record.ui = nextState;
}
function mergeLegacySessionUiStateIntoProjectChat(config, normalizedConfig, projectPath = '') {
  const legacyMap = config?.[SESSION_UI_STATE_BY_PATH_KEY];
  if (!legacyMap || typeof legacyMap !== 'object' || Array.isArray(legacyMap)) {
    return;
  }
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  Object.entries(legacyMap).forEach(([stateKey, rawState]) => {
    const parsedKey = parseSessionUiStateKey(stateKey);
    if (!parsedKey || parsedKey.projectPath !== normalizedProjectPath) {
      return;
    }
    const location = findProjectChatRecord(normalizedConfig, parsedKey.sessionId, parsedKey.provider);
    if (!location) {
      return;
    }
    writeProjectChatRecordUiState(location.record, parsedKey.provider, {
      ...normalizeSessionUiState(rawState),
      ...normalizeSessionUiState(location.record.ui),
    });
  });
}
function normalizeProjectConfigForSave(config, projectPath = '') {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }
  const normalized = Object.fromEntries(Object.entries(config).filter(([key]) => ![
    MANUAL_SESSION_DRAFTS_KEY,
    LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY,
    LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY,
    SESSION_UI_STATE_BY_PATH_KEY,
    SESSION_MODEL_STATE_BY_ID_KEY,
    SESSION_ROUTE_INDEX_KEY,
    LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY,
    LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY,
  ].includes(key)));
  normalized.schemaVersion = PROJECT_CONFIG_SCHEMA_VERSION;
  normalized.chat = normalizeProjectChatBucket(config.chat);
  delete normalized.workflows;
  mergeLegacySessionUiStateIntoProjectChat(config, normalized, projectPath);
  delete normalized[LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY];
  const summaryById = getSessionSummaryOverrideMap(config);
  if (Object.keys(summaryById).length > 0) {
    normalized[SESSION_SUMMARY_BY_ID_KEY] = summaryById;
  } else {
    delete normalized[SESSION_SUMMARY_BY_ID_KEY];
  }
  delete normalized[LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY];
  delete normalized[LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY];
  const routeCounter = getManualSessionRouteCounter(normalized, projectPath);
  if (routeCounter > 0) {
    normalized[MANUAL_SESSION_ROUTE_COUNTER_KEY] = routeCounter;
  }
  delete normalized[LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY];
  const workflowMetadataById = getSessionWorkflowMetadataMap(config);
  if (Object.keys(workflowMetadataById).length > 0) {
    normalized[SESSION_WORKFLOW_METADATA_BY_ID_KEY] = workflowMetadataById;
  }
  const modelStateById = getSessionModelStateMap(config);
  const uiStateByPath = getSessionUiStateMap(config, projectPath);
  const uiStateBySessionId = Object.entries(uiStateByPath).reduce((stateById, [key, state]) => {
    const sessionId = String(key).split(':').pop();
    if (sessionId && state && typeof state === 'object' && !Array.isArray(state)) {
      stateById[sessionId] = state;
    }
    return stateById;
  }, {});
  Object.entries(getManualSessionDraftMap(config)).forEach(([draftId, draft]) => {
    const hydratedDraftIds = config[HYDRATED_MANUAL_SESSION_DRAFT_IDS];
    const routeIndexFromId = parseManualSessionRouteIndex(draftId);
    const routeIndex = isWorkflowOwnedDraft(draft)
      ? (Number(draft?.routeIndex) || parseManualSessionRouteIndex(draftId))
      : (parseManualSessionRouteIndex(draftId) || Number(draft?.routeIndex));
    if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
      return;
    }
    if (hydratedDraftIds instanceof Set && hydratedDraftIds.has(draftId) && !config.chat?.[String(routeIndexFromId || routeIndex)]) {
      return;
    }
    if (isWorkflowOwnedDraft(draft)) {
      return;
    } else {
      normalized.chat[String(routeIndex)] = buildProjectChatRecord(
        draftId,
        draft.label,
        modelStateById[draftId],
        uiStateBySessionId[draftId],
        draft,
      );
    }
  });
  if (Object.keys(normalized.chat).length === 0) delete normalized.chat;
  delete normalized.workflows;
  [
    LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY,
    LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY,
    SESSION_UI_STATE_BY_PATH_KEY,
    SESSION_MODEL_STATE_BY_ID_KEY,
    SESSION_ROUTE_INDEX_KEY,
    LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY,
    LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY,
  ].forEach((key) => {
    delete normalized[key];
  });
  return normalized;
}
function mergeCurrentWorkflowConfig(currentConfig, nextConfig) {
  void currentConfig;
  delete nextConfig.workflows;
  return nextConfig;
}
async function saveProjectConfig(config, projectPath = '') {
  let nextConfig = normalizeProjectConfigForSave(config, projectPath);
  try {
    const currentConfig = await readProjectLocalConfig(projectPath);
    nextConfig = mergeCurrentWorkflowConfig(currentConfig, nextConfig);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  await writeProjectLocalConfig(projectPath, nextConfig);
}
function getDisplayNameByPathMap(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  const rawMap = config[PROJECT_DISPLAY_NAME_BY_PATH_KEY];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {};
  }
  return rawMap;
}
function getSessionSummaryOverrideMap(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const summaryById = {
      ...normalizeSessionSummaryMapForRead(config[SESSION_SUMMARY_BY_ID_KEY], config),
    };
    Object.values(config.chat || {}).forEach((record) => {
      if (record?.sessionId && record?.title && record.titleSource !== AUTO_IMPORTED_ROUTE_TITLE_SOURCE) {
        summaryById[record.sessionId] = record.title;
      }
    });
    Object.values(config.workflows || {}).forEach((workflow) => {
      Object.values(workflow?.chat || {}).forEach((record) => {
        if (record?.sessionId && record?.title) summaryById[record.sessionId] = record.title;
      });
    });
    return summaryById;
  }
  return [
    config[LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY],
    config[LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY],
    config[SESSION_SUMMARY_BY_ID_KEY],
  ].reduce((summaryById, rawMap) => {
    if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
      return summaryById;
    }
    return {
      ...summaryById,
      ...normalizeSessionSummaryMapForRead(rawMap, config),
    };
  }, {});
}
function writeSessionSummaryOverride(config, sessionId, summary) {
  config[SESSION_SUMMARY_BY_ID_KEY] = {
    ...getSessionSummaryOverrideMap(config),
    [sessionId]: summary,
  };
  delete config[LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY];
  delete config[LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY];
}
function isPositiveRouteIndexKey(key) {
  const routeIndex = Number(key);
  return Number.isInteger(routeIndex) && routeIndex > 0 && String(routeIndex) === String(key);
}
function normalizeSessionSummaryMapForRead(rawMap, config) {
  return Object.entries(rawMap || {}).reduce((summaryById, [key, summary]) => {
    const sessionId = isPositiveRouteIndexKey(key)
      ? findSessionIdByRouteIndex(config, Number(key))
      : key;
    if (sessionId) {
      summaryById[sessionId] = summary;
    }
    return summaryById;
  }, {});
}
function deleteSessionSummaryOverride(config, sessionId) {
  const summaryById = getSessionSummaryOverrideMap(config);
  if (!Object.prototype.hasOwnProperty.call(summaryById, sessionId)) {
    return false;
  }
  delete summaryById[sessionId];
  if (Object.keys(summaryById).length === 0) {
    delete config[SESSION_SUMMARY_BY_ID_KEY];
  } else {
    config[SESSION_SUMMARY_BY_ID_KEY] = summaryById;
  }
  delete config[LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY];
  delete config[LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY];
  return true;
}
function deleteProjectChatRecords(config, sessionId, provider = null) {
  let changed = false;
  const shouldDeleteRecord = (routeIndex, record) => {
    const routeSessionId = Number.isInteger(Number(routeIndex)) && Number(routeIndex) > 0
      ? buildManualSessionId(Number(routeIndex))
      : '';
    const recordSessionId = typeof record?.sessionId === 'string' ? record.sessionId : '';
    const providerSessionId = typeof record?.providerSessionId === 'string' ? record.providerSessionId : '';
    const matchesSession = recordSessionId === sessionId
      || routeSessionId === sessionId
      || providerSessionId === sessionId;
    if (!matchesSession) {
      return false;
    }
    return !provider || !record.provider || record.provider === provider;
  };
  Object.entries(config.chat || {}).forEach(([routeIndex, record]) => {
    if (shouldDeleteRecord(routeIndex, record)) {
      delete config.chat[routeIndex];
      changed = true;
    }
  });
  if (config.chat && Object.keys(config.chat).length === 0) {
    delete config.chat;
  }
  Object.values(config.workflows || {}).forEach((workflow) => {
    Object.entries(workflow?.chat || {}).forEach(([routeIndex, record]) => {
      if (shouldDeleteRecord(routeIndex, record)) {
        delete workflow.chat[routeIndex];
        changed = true;
      }
    });
    if (workflow?.chat && Object.keys(workflow.chat).length === 0) {
      delete workflow.chat;
    }
  });
  return changed;
}
function getSessionWorkflowMetadataMap(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const storedMetadata = config[SESSION_WORKFLOW_METADATA_BY_ID_KEY] && typeof config[SESSION_WORKFLOW_METADATA_BY_ID_KEY] === 'object'
      ? config[SESSION_WORKFLOW_METADATA_BY_ID_KEY]
      : {};
    return Object.entries(config.workflows || {}).reduce((metadataById, [workflowIndex, workflow]) => {
      Object.values(workflow?.chat || {}).forEach((record) => {
        if (record?.sessionId) {
          if (!metadataById[record.sessionId]) {
            metadataById[record.sessionId] = {
              workflowId: typeof record.workflowId === 'string' && record.workflowId.trim()
                ? record.workflowId.trim()
                : `w${workflowIndex}`,
              provider: record.provider,
              stageKey: record.stageKey,
              origin: SESSION_ORIGIN_WORKFLOW,
            };
          }
        }
      });
      return metadataById;
    }, { ...storedMetadata });
  }
  const rawMap = config[SESSION_WORKFLOW_METADATA_BY_ID_KEY];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {};
  }
  return rawMap;
}
function getManualSessionDraftMap(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const drafts = {};
    Object.entries(config.chat || {}).forEach(([routeIndex, record]) => {
      if (parseManualSessionRouteIndex(record?.sessionId)) {
        drafts[record.sessionId] = {
          id: record.sessionId,
          provider: record.provider || 'codex',
          label: record.title,
          routeIndex: Number(routeIndex),
          providerSessionId: record.providerSessionId,
          origin: record.origin === SESSION_ORIGIN_WORKFLOW ? SESSION_ORIGIN_WORKFLOW : SESSION_ORIGIN_MANUAL,
        };
      }
    });
    Object.entries(config.workflows || {}).forEach(([workflowIndex, workflow]) => {
      Object.entries(workflow?.chat || {}).forEach(([routeIndex, record]) => {
        if (parseManualSessionRouteIndex(record?.sessionId)) {
          drafts[record.sessionId] = {
            id: record.sessionId,
            provider: record.provider || 'codex',
            label: record.title,
            summary: record.summary,
            workflowId: typeof record.workflowId === 'string' && record.workflowId.trim()
              ? record.workflowId.trim()
              : `w${workflowIndex}`,
            routeIndex: Number(routeIndex),
            stageKey: record.stageKey,
            providerSessionId: record.providerSessionId,
            origin: SESSION_ORIGIN_WORKFLOW,
          };
        }
      });
    });
    const rawMap = config[MANUAL_SESSION_DRAFTS_KEY];
    if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
      Object.entries(rawMap).forEach(([draftId, draft]) => {
        drafts[draftId] = {
          ...(drafts[draftId] && typeof drafts[draftId] === 'object' ? drafts[draftId] : {}),
          ...(draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {}),
          id: typeof draft?.id === 'string' && draft.id ? draft.id : draftId,
          providerSessionId: typeof draft?.providerSessionId === 'string' && draft.providerSessionId.trim()
            ? draft.providerSessionId.trim()
            : drafts[draftId]?.providerSessionId,
        };
      });
    }
    return drafts;
  }
  const rawMap = config[MANUAL_SESSION_DRAFTS_KEY];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {};
  }
  return Object.fromEntries(Object.entries(rawMap).map(([draftId, draft]) => [
    draftId,
    {
      ...(draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {}),
      id: typeof draft?.id === 'string' && draft.id ? draft.id : draftId,
    },
  ]));
}
function parseManualSessionRouteIndex(sessionId) {
  const matched = String(sessionId || '').match(/^c(\d+)$/);
  if (!matched) {
    return null;
  }
  const parsed = Number(matched[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function buildManualSessionId(routeIndex) {
  return Number.isInteger(routeIndex) && routeIndex > 0 ? `c${routeIndex}` : null;
}
function getSessionRouteStoreDependencies() {
  return {
    extractProjectDirectory,
    loadProjectConfig,
    saveProjectConfig,
    findProjectChatRecord,
    getManualSessionDraftMap,
    parseManualSessionRouteIndex,
    buildManualSessionId,
    buildProjectChatRecord,
    writeSessionSummaryOverride,
    writeManualSessionRouteCounter,
    getSessionWorkflowMetadataMap,
    clearProjectDirectoryCache,
    constants: {
      manualSessionDraftsKey: MANUAL_SESSION_DRAFTS_KEY,
      sessionWorkflowMetadataByIdKey: SESSION_WORKFLOW_METADATA_BY_ID_KEY,
      sessionOriginManual: SESSION_ORIGIN_MANUAL,
      sessionOriginWorkflow: SESSION_ORIGIN_WORKFLOW,
    },
  };
}
function applySessionSummaryOverride(session, summaryOverrideById) {
  if (!session || typeof session !== 'object') {
    return session;
  }
  const override = summaryOverrideById?.[session.id];
  if (typeof override !== 'string' || !override.trim()) {
    return session;
  }
  return {
    ...session,
    title: override,
    summary: override,
    name: override,
  };
}
function applySessionWorkflowMetadata(session, workflowMetadataById, provider = '') {
  if (!session || typeof session !== 'object') {
    return session;
  }
  const metadata = workflowMetadataById?.[session.id];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return session;
  }
  const sessionProvider = String(provider || session.provider || '').trim();
  const metadataProvider = String(metadata.provider || '').trim();
  if (sessionProvider && metadataProvider && sessionProvider !== metadataProvider) {
    return session;
  }
  return {
    ...session,
    workflowId: typeof metadata.workflowId === 'string' ? metadata.workflowId : session.workflowId,
    stageKey: typeof metadata.stageKey === 'string' ? metadata.stageKey : session.stageKey,
    origin: metadata.origin === SESSION_ORIGIN_WORKFLOW ? SESSION_ORIGIN_WORKFLOW : session.origin,
  };
}
function getSessionOriginByIdMap(config, provider = '') {
  const originById = {};
  const normalizedProvider = provider ? normalizeProjectChatProvider(provider) : '';
  const providerMatches = (recordProvider) => (
    !normalizedProvider || normalizeProjectChatProvider(recordProvider) === normalizedProvider
  );
  Object.values(config?.chat || {}).forEach((record) => {
    if (!record?.sessionId || !providerMatches(record.provider)) {
      return;
    }
    if (record.titleSource === AUTO_IMPORTED_ROUTE_TITLE_SOURCE) {
      return;
    }
    if (record.origin === SESSION_ORIGIN_MANUAL || record.origin === SESSION_ORIGIN_WORKFLOW) {
      originById[record.sessionId] = record.origin;
    }
  });
  Object.values(config?.workflows || {}).forEach((workflow) => {
    Object.values(workflow?.chat || {}).forEach((record) => {
      if (record?.sessionId && providerMatches(record.provider)) {
        originById[record.sessionId] = SESSION_ORIGIN_WORKFLOW;
      }
    });
  });
  Object.entries(getSessionWorkflowMetadataMap(config)).forEach(([sessionId, metadata]) => {
    if (!providerMatches(metadata?.provider)) {
      return;
    }
    if (metadata?.origin === SESSION_ORIGIN_WORKFLOW || metadata?.workflowId) {
      originById[sessionId] = SESSION_ORIGIN_WORKFLOW;
    }
  });
  return originById;
}
function applySessionOriginMetadata(session, originById) {
  if (session?.origin === SESSION_ORIGIN_WORKFLOW) {
    return session;
  }
  const origin = originById?.[session?.id];
  if (origin !== SESSION_ORIGIN_MANUAL && origin !== SESSION_ORIGIN_WORKFLOW) {
    return session;
  }
  return {
    ...session,
    origin,
  };
}
function isManualOriginSession(session) {
  return session?.origin === SESSION_ORIGIN_MANUAL
    && session?.titleSource !== AUTO_IMPORTED_ROUTE_TITLE_SOURCE;
}
function applySessionMetadataOverrides(session, summaryOverrideById, workflowMetadataById, provider = '', originById = {}) {
  return applySessionWorkflowMetadata(
    applySessionOriginMetadata(
      applySessionSummaryOverride(session, summaryOverrideById),
      originById,
    ),
    workflowMetadataById,
    provider,
  );
}
function buildManualDraftSession(draft) {
  const label = typeof draft?.label === 'string' && draft.label.trim()
    ? draft.label.trim()
    : '新会话';
  const createdAt = draft?.createdAt || new Date().toISOString();
  const updatedAt = draft?.updatedAt || createdAt;
  const provider = draft?.provider === 'pi' ? 'pi' : 'codex';
  return {
    id: draft.id,
    routeIndex: parseManualSessionRouteIndex(draft.id) || (Number.isInteger(draft?.routeIndex) ? draft.routeIndex : undefined),
    title: label,
    summary: label,
    name: label,
    createdAt,
    updated_at: updatedAt,
    lastActivity: updatedAt,
    messageCount: 0,
    projectPath: draft.projectPath || '',
    provider,
    __provider: provider,
    status: 'draft',
    providerSessionId: typeof draft?.providerSessionId === 'string' ? draft.providerSessionId : undefined,
    workflowId: typeof draft?.workflowId === 'string' ? draft.workflowId : undefined,
    stageKey: typeof draft?.stageKey === 'string' ? draft.stageKey : undefined,
    origin: draft?.origin === SESSION_ORIGIN_WORKFLOW || draft?.workflowId
      ? SESSION_ORIGIN_WORKFLOW
      : SESSION_ORIGIN_MANUAL,
  };
}
function isWorkflowOwnedDraft(draft) {
  return typeof draft?.workflowId === 'string' && draft.workflowId.trim();
}
function isWorkflowOwnedSession(session, workflowMetadataById = {}) {
  if (typeof session?.workflowId === 'string' && session.workflowId.trim()) {
    return true;
  }
  const metadata = workflowMetadataById?.[session?.id];
  const sessionProvider = String(session?.provider || '').trim();
  const metadataProvider = String(metadata?.provider || '').trim();
  if (sessionProvider && metadataProvider && sessionProvider !== metadataProvider) {
    return false;
  }
  return typeof metadata?.workflowId === 'string' && metadata.workflowId.trim();
}
function getSessionDisplayText(session = {}) {
    return String(session.title || session.summary || session.name || session.message || '').trim();
}
function hasBoundPiManualDraft(draft = {}) {
    if (draft?.provider !== 'pi') {
    return true;
  }
  if (draft.routeCancelFlag === true) {
    return false;
  }
  const providerSessionId = typeof draft.providerSessionId === 'string'
    ? draft.providerSessionId.trim()
    : '';
  return Boolean(providerSessionId);
}
function buildWorkflowAutoSessionPrefixes(workflow = {}) {
    const workflowTitle = String(workflow.title || workflow.objective || '').trim();
  if (!workflowTitle) {
    return [];
  }
  return [
    `规划提案：${workflowTitle}`,
    `提案落地：${workflowTitle}`,
    `归档：${workflowTitle}`,
    ...[1, 2, 3].flatMap((passIndex) => [
      `评审${passIndex}：${workflowTitle}`,
      `修复${passIndex}：${workflowTitle}`,
    ]),
  ];
}
function isLikelyWorkflowAutoSession(session, workflows = [], provider = '') {
    if (session?.workflowId || session?.stageKey || session?.origin === SESSION_ORIGIN_WORKFLOW) {
    return true;
  }
  const displayText = getSessionDisplayText(session);
  if (!displayText) {
    return false;
  }
  if (/^(规划提案|提案落地|归档|评审\d+|修复\d+)：/.test(displayText)) {
    return true;
  }
  if (displayText.startsWith('执行 OpenSpec 变更中的任务')) {
    return true;
  }
  if (workflows.some((workflow) => (
    buildWorkflowAutoSessionPrefixes(workflow).some((prefix) => displayText.startsWith(prefix))
  ))) {
    return true;
  }
  return provider === 'claude'
    && workflows.length > 0
    && displayText.startsWith('执行 OpenSpec 变更中的任务');
}
function getWorkflowOwnedProviderSessionIds(workflows = [], provider = '') {
    const sessionIds = new Set();
  const addProviderSessionId = (sessionId, sessionProvider) => {
    if (normalizeProjectChatProvider(sessionProvider) === provider && sessionId) {
      sessionIds.add(sessionId);
    }
  };
  for (const workflow of workflows) {
    for (const session of workflow?.workflowOwnedSessionRefs || []) {
      addProviderSessionId(session?.sessionId, session?.provider);
    }
    for (const session of workflow?.childSessions || []) {
      addProviderSessionId(session?.id, session?.provider);
    }
    for (const process of workflow?.runnerProcesses || []) {
      addProviderSessionId(process?.sessionId, process?.provider);
    }
    for (const session of workflow?.runnerDiagnostics?.workflowOwnedSessions || []) {
      addProviderSessionId(session?.sessionId, session?.provider);
    }
    for (const session of workflow?.diagnostics?.workflowOwnedSessions || []) {
      addProviderSessionId(session?.sessionId, session?.provider);
    }
  }
  return sessionIds;
}
function isWorkflowOwnedProviderSessionId(session, workflowOwnedSessionIds) {
    if (!(workflowOwnedSessionIds instanceof Set)) {
    return false;
  }
  return [
    session?.id,
    session?.providerSessionId,
    session?.sourceSessionId,
    session?.source_session_id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .some((sessionId) => workflowOwnedSessionIds.has(sessionId));
}
async function applyWorkflowOwnedOriginFromState(provider, sessions, workflowOwnedSessionIds) {
    if (!(workflowOwnedSessionIds instanceof Set) || workflowOwnedSessionIds.size === 0) {
    return sessions;
  }
  const markedSessions = [];
  const result = sessions.map((session) => {
    if (!isWorkflowOwnedProviderSessionId(session, workflowOwnedSessionIds)) {
      return session;
    }
    if (session?.origin === SESSION_ORIGIN_WORKFLOW) {
      return session;
    }
    const markedSession = { ...session, origin: SESSION_ORIGIN_WORKFLOW };
    markedSessions.push(markedSession);
    return markedSession;
  });
  await Promise.all(markedSessions.map((session) => upsertProviderSessionIndex(provider, session)));
  return result;
}
function getWorkflowOwnedRouteSessionIds(config) {
  const workflowOwnedIds = new Set();
  Object.entries(getSessionWorkflowMetadataMap(config)).forEach(([sessionId, metadata]) => {
    if (typeof metadata?.workflowId === 'string' && metadata.workflowId.trim()) {
      workflowOwnedIds.add(sessionId);
    }
  });
  Object.entries(getManualSessionDraftMap(config)).forEach(([sessionId, draft]) => {
    if (isWorkflowOwnedDraft(draft)) {
      workflowOwnedIds.add(sessionId);
    }
  });
  return workflowOwnedIds;
}
function getManualDraftSessionsForProject(config, { projectName, projectPath, provider }) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  const drafts = Object.values(getManualSessionDraftMap(config))
    .filter((draft) => {
      if (!draft || typeof draft !== 'object') {
        return false;
      }
      if (draft.provider !== provider) {
        return false;
      }
      if (draft.origin === SESSION_ORIGIN_WORKFLOW || isWorkflowOwnedDraft(draft)) {
        return false;
      }
      if (provider === 'pi' && !hasBoundPiManualDraft(draft)) {
        return false;
      }
      if (!draft.projectName && !draft.projectPath) {
        return true;
      }
      if (provider === 'claude') {
        return draft.projectName === projectName;
      }
      return normalizeComparablePath(draft.projectPath) === normalizedProjectPath;
    })
    .map((draft) => buildManualDraftSession(draft));
  return drafts.sort(
    (sessionA, sessionB) => new Date(sessionB.lastActivity || 0) - new Date(sessionA.lastActivity || 0),
  );
}
function getPersistedChatRouteSessionsForProject(config, { projectPath, provider }) {
  const normalizedProvider = normalizeProjectChatProvider(provider);
  return Object.entries(config?.chat || {})
    .map(([routeIndexKey, record]) => {
      if (!record || typeof record !== 'object') {
        return null;
      }
      if (normalizeProjectChatProvider(record.provider) !== normalizedProvider) {
        return null;
      }
      if (parseManualSessionRouteIndex(record.sessionId)) {
        return null;
      }
      const routeIndex = Number(routeIndexKey);
      if (!record.sessionId || !Number.isInteger(routeIndex) || routeIndex <= 0) {
        return null;
      }
      const title = record.title || record.summary || record.sessionId;
      return {
        id: record.sessionId,
        routeIndex,
        title,
        summary: record.summary || title,
        name: title,
        createdAt: record.createdAt || record.updatedAt || new Date().toISOString(),
        updated_at: record.updatedAt || record.createdAt || new Date().toISOString(),
        lastActivity: record.updatedAt || record.createdAt || new Date().toISOString(),
        messageCount: null,
        messageCountKnown: false,
        provider: normalizedProvider,
        __provider: normalizedProvider,
        projectPath,
        providerSessionId: record.providerSessionId || record.sessionId,
        workflowId: typeof record.workflowId === 'string' ? record.workflowId : undefined,
        stageKey: typeof record.stageKey === 'string' ? record.stageKey : undefined,
        origin: record.origin === SESSION_ORIGIN_WORKFLOW ? SESSION_ORIGIN_WORKFLOW : SESSION_ORIGIN_MANUAL,
      };
    })
    .filter(Boolean);
}
function getSessionUiStateMap(config, projectPath = '') {
  if (!config || typeof config !== 'object') {
    return {};
  }
  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const uiByPath = {};
    const addRecordState = (record, routeIndex = null) => {
      const uiState = normalizeSessionUiState(record?.ui);
      if (!record?.sessionId || Object.keys(uiState).length === 0) {
        return;
      }
      const providers = typeof record.provider === 'string' && record.provider.trim()
        ? [normalizeProjectChatProvider(record.provider)]
        : ['claude', 'codex'];
      const sessionIds = [
        record.sessionId,
        typeof record.providerSessionId === 'string' && record.providerSessionId.trim()
          ? record.providerSessionId.trim()
          : null,
        Number.isInteger(Number(routeIndex)) && Number(routeIndex) > 0
          ? buildManualSessionId(Number(routeIndex))
          : null,
      ].filter((value, index, values) => value && values.indexOf(value) === index);
      providers.forEach((recordProvider) => {
        sessionIds.forEach((recordSessionId) => {
          const stateKey = buildSessionUiStateKey(projectPath, recordProvider, recordSessionId);
          if (stateKey && !uiByPath[stateKey]) {
            uiByPath[stateKey] = uiState;
          }
        });
      });
    };
    Object.entries(config.chat || {}).forEach(([routeIndex, record]) => {
      addRecordState(record, routeIndex);
    });
    Object.values(config.workflows || {}).forEach((workflow) => {
      Object.entries(workflow?.chat || {}).forEach(([routeIndex, record]) => {
        addRecordState(record, routeIndex);
      });
    });
    const rawMap = config[SESSION_UI_STATE_BY_PATH_KEY];
    if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
      Object.entries(rawMap).forEach(([stateKey, rawState]) => {
        if (!uiByPath[stateKey]) {
          const uiState = normalizeSessionUiState(rawState);
          if (Object.keys(uiState).length > 0) {
            uiByPath[stateKey] = uiState;
          }
        }
      });
    }
    return uiByPath;
  }
  const rawMap = config[SESSION_UI_STATE_BY_PATH_KEY];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {};
  }
  return rawMap;
}
function buildSessionUiStateKey(projectPath, provider, sessionId) {
  const normalizedPath = normalizeComparablePath(projectPath);
  if (!normalizedPath || !sessionId) {
    return null;
  }
  return `${provider}:${normalizedPath}:${sessionId}`;
}
function applySessionUiState(session, projectPath, provider, config) {
  const sessionUiStateMap = getSessionUiStateMap(config, projectPath);
  const stateKey = buildSessionUiStateKey(projectPath, provider, session?.id);
  const persistedState = stateKey ? sessionUiStateMap[stateKey] : null;
  if (!persistedState || typeof persistedState !== 'object') {
    return session;
  }
  return {
    ...session,
    favorite: persistedState.favorite === true,
    pending: persistedState.pending === true,
    hidden: persistedState.hidden === true || session.hidden === true,
  };
}
function buildProjectRoutePath(projectPath) {
    const normalizedPath = normalizeComparablePath(projectPath);
  if (!normalizedPath) {
    return '/';
  }
  const normalizedHome = normalizeComparablePath(os.homedir());
  if (normalizedHome && (normalizedPath === normalizedHome || normalizedPath.startsWith(`${normalizedHome}/`))) {
    const relativePath = normalizedPath.slice(normalizedHome.length).replace(/^\/+/g, '');
    return relativePath ? `/${relativePath}` : '/~';
  }
  return normalizedPath;
}
function findSessionIdByRouteIndex(config, routeIndex) {
  if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
    return null;
  }
  const record = config?.chat?.[String(routeIndex)];
  return typeof record?.sessionId === 'string' && record.sessionId ? record.sessionId : null;
}
function getManualSessionRouteCounter(config, projectPath) {
  if (!config || typeof config !== 'object') {
    return 0;
  }
  const counter = Number(config[MANUAL_SESSION_ROUTE_COUNTER_KEY]);
  if (Number.isInteger(counter) && counter > 0) {
    return counter;
  }
  const bucketKey = normalizeComparablePath(projectPath);
  const legacyMap = config[LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY];
  const legacyCounter = Number(bucketKey && legacyMap?.[bucketKey]);
  return Number.isInteger(legacyCounter) && legacyCounter > 0 ? legacyCounter : 0;
}
function getMaxStandaloneSessionRouteIndex(config, projectPath) {
  const chatMax = Object.entries(config?.chat || {}).reduce((maxValue, [routeIndexKey, record]) => {
    const parsed = Number(routeIndexKey);
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, 0);
  return Object.entries(getManualSessionDraftMap(config)).reduce((maxValue, [draftId, draft]) => {
    const parsed = parseManualSessionRouteIndex(draftId) || Number(draft?.routeIndex);
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, chatMax);
}
function getNextManualSessionRouteIndex(config, projectPath, currentStandaloneCount = 0) {
  const persistedCounter = getManualSessionRouteCounter(config, projectPath);
  const maxStandaloneRouteIndex = getMaxStandaloneSessionRouteIndex(config, projectPath);
  const baselineCounter = Number.isInteger(persistedCounter) && persistedCounter > 0
    ? persistedCounter
    : Number(currentStandaloneCount || 0);
  return Math.max(
    baselineCounter,
    Number(currentStandaloneCount || 0),
    maxStandaloneRouteIndex,
  ) + 1;
}
function writeManualSessionRouteCounter(config, projectPath, routeIndex) {
  if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
    return;
  }
  config[MANUAL_SESSION_ROUTE_COUNTER_KEY] = Math.max(
    getManualSessionRouteCounter(config, projectPath),
    routeIndex,
  );
  delete config[LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY];
}
function deleteConfigMapEntry(config, mapKey, entryKey) {
  const rawMap = config?.[mapKey];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(rawMap, entryKey)) {
    return false;
  }
  delete rawMap[entryKey];
  if (Object.keys(rawMap).length === 0) {
    delete config[mapKey];
  }
  return true;
}
function getSessionModelStateMap(config) {
  if (config?.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const modelById = {};
    Object.values(config.chat || {}).forEach((record) => {
      if (record?.sessionId) {
        modelById[record.sessionId] = {
          model: record.model,
          reasoningEffort: record.reasoningEffort,
          thinkingMode: record.thinkingMode,
        };
      }
    });
    Object.values(config.workflows || {}).forEach((workflow) => {
      Object.values(workflow?.chat || {}).forEach((record) => {
        if (record?.sessionId) {
          modelById[record.sessionId] = {
            model: record.model,
            reasoningEffort: record.reasoningEffort,
            thinkingMode: record.thinkingMode,
          };
        }
      });
    });
    const rawMap = config?.[SESSION_MODEL_STATE_BY_ID_KEY];
    if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
      Object.entries(rawMap).forEach(([sessionId, state]) => {
        modelById[sessionId] = { ...modelById[sessionId], ...state };
      });
    }
    return modelById;
  }
  const rawMap = config?.[SESSION_MODEL_STATE_BY_ID_KEY];
  return rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? rawMap : {};
}
function normalizeSessionModelState(rawState) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    return {};
  }
  const state = {};
  if (typeof rawState.model === 'string' && rawState.model.trim()) {
    state.model = rawState.model.trim();
  }
  if (typeof rawState.reasoningEffort === 'string' && rawState.reasoningEffort.trim()) {
    state.reasoningEffort = rawState.reasoningEffort.trim();
  }
  if (typeof rawState.thinkingMode === 'string' && rawState.thinkingMode.trim()) {
    state.thinkingMode = rawState.thinkingMode.trim();
  }
  if (typeof rawState.thinkingLevel === 'string' && rawState.thinkingLevel.trim()) {
    state.thinkingLevel = rawState.thinkingLevel.trim();
  } else if (typeof rawState.thinkingMode === 'string' && rawState.thinkingMode.trim()) {
    state.thinkingLevel = rawState.thinkingMode.trim();
  }
  if (typeof rawState.updatedAt === 'string' && rawState.updatedAt.trim()) {
    state.updatedAt = rawState.updatedAt.trim();
  }
  return state;
}
function applySessionModelState(session, modelStateById) {
  const state = normalizeSessionModelState(modelStateById?.[session?.id]);
  if (!Object.keys(state).length) {
    return session;
  }
  return {
    ...session,
    model: state.model || session.model,
    reasoningEffort: state.reasoningEffort || session.reasoningEffort,
    thinkingMode: state.thinkingMode || session.thinkingMode,
    thinkingLevel: state.thinkingLevel || session.thinkingLevel,
  };
}
async function getSessionModelState(projectPath = '', sessionId = '') {
  if (!sessionId) {
    return {};
  }
  const config = await loadProjectConfig(projectPath);
  return normalizeSessionModelState(getSessionModelStateMap(config)[sessionId]);
}
async function updateSessionModelState(projectPath = '', sessionId = '', patch = {}) {
  if (!sessionId) {
    throw new Error('Session id is required');
  }
  const config = await loadProjectConfig(projectPath);
  const modelStateById = {
    ...getSessionModelStateMap(config),
  };
  const previous = normalizeSessionModelState(modelStateById[sessionId]);
  const next = {
    ...previous,
  };
  if (typeof patch.model === 'string' && patch.model.trim()) {
    next.model = patch.model.trim();
  }
  if (typeof patch.reasoningEffort === 'string' && patch.reasoningEffort.trim()) {
    next.reasoningEffort = patch.reasoningEffort.trim();
  }
  if (typeof patch.thinkingMode === 'string' && patch.thinkingMode.trim()) {
    next.thinkingMode = patch.thinkingMode.trim();
  }
  if (typeof patch.thinkingLevel === 'string' && patch.thinkingLevel.trim()) {
    next.thinkingLevel = patch.thinkingLevel.trim();
    next.thinkingMode = patch.thinkingLevel.trim();
  }
  next.updatedAt = new Date().toISOString();
  modelStateById[sessionId] = next;
  config[SESSION_MODEL_STATE_BY_ID_KEY] = modelStateById;
  Object.values(config.chat || {}).forEach((record) => {
    if (!record || record.sessionId !== sessionId) {
      return;
    }
    if (next.model) {
      record.model = next.model;
    }
    if (next.reasoningEffort) {
      record.reasoningEffort = next.reasoningEffort;
    }
    if (next.thinkingMode) {
      record.thinkingMode = next.thinkingMode;
    }
    if (next.thinkingLevel) {
      record.thinkingLevel = next.thinkingLevel;
    }
  });
  await saveProjectConfig(config, projectPath);
  return next;
}
async function cleanupDeletedSessionConfig(sessionId, projectPath = '', provider = null) {
  const pathsToClean = [...new Set([projectPath || '', ''])];
  for (const configPath of pathsToClean) {
    const config = await loadProjectConfig(configPath);
    let changed = false;
    changed = deleteConfigMapEntry(config, MANUAL_SESSION_DRAFTS_KEY, sessionId) || changed;
    changed = deleteSessionSummaryOverride(config, sessionId) || changed;
    changed = deleteConfigMapEntry(config, LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY, sessionId) || changed;
    changed = deleteConfigMapEntry(config, LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY, sessionId) || changed;
    changed = deleteConfigMapEntry(config, SESSION_WORKFLOW_METADATA_BY_ID_KEY, sessionId) || changed;
    changed = deleteConfigMapEntry(config, SESSION_MODEL_STATE_BY_ID_KEY, sessionId) || changed;
    changed = deleteProjectChatRecords(config, sessionId, provider) || changed;
    const uiStateMap = getSessionUiStateMap(config, configPath);
    Object.keys(uiStateMap).forEach((stateKey) => {
      const matchesProvider = !provider || stateKey.startsWith(`${provider}:`);
      if (matchesProvider && stateKey.endsWith(`:${sessionId}`)) {
        delete uiStateMap[stateKey];
        changed = true;
      }
    });
    if (Object.keys(uiStateMap).length === 0) {
      delete config[SESSION_UI_STATE_BY_PATH_KEY];
    }
    if (changed) {
      await saveProjectConfig(config, configPath);
    }
  }
}
function attachSessionRouteIndices(config, projectPath, provider, sessions = [], options = {}) {
    const routeTitleBySessionId = options.routeTitleBySessionId instanceof Map
    ? options.routeTitleBySessionId
    : new Map();
  config.schemaVersion = PROJECT_CONFIG_SCHEMA_VERSION;
  config.chat = config.chat && typeof config.chat === 'object' && !Array.isArray(config.chat) ? config.chat : {};
  const sessionIds = new Set(sessions.map((session) => session?.id).filter(Boolean));
  const reservedRouteIndices = new Set();
  let maxRouteIndex = Object.entries(config.chat).reduce((maxValue, [routeIndexKey, record]) => {
    const parsed = Number(routeIndexKey);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return maxValue;
    }
    const routeSessionId = buildManualSessionId(parsed);
    if (
      !sessionIds.has(record?.sessionId)
      && !sessionIds.has(routeSessionId)
    ) {
      reservedRouteIndices.add(parsed);
    }
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, 0);
  const usedRouteIndices = new Set();
  let changed = false;
  const existingRouteBySessionId = new Map();
  Object.entries(config.chat).forEach(([routeIndex, record]) => {
    if (record?.sessionId) {
      existingRouteBySessionId.set(record.sessionId, routeIndex);
    }
    const routeSessionId = buildManualSessionId(Number(routeIndex));
    if (routeSessionId) {
      existingRouteBySessionId.set(routeSessionId, routeIndex);
    }
  });
  const routeIndexBySessionId = new Map();
  const sessionsByCreation = [...sessions].sort((sessionA, sessionB) => (
    new Date(sessionA?.createdAt || sessionA?.created_at || sessionA?.lastActivity || 0).getTime()
    - new Date(sessionB?.createdAt || sessionB?.created_at || sessionB?.lastActivity || 0).getTime()
  ));
  sessionsByCreation.forEach((session) => {
    if (!session?.id) {
      return;
    }
    let routeIndex = Number(existingRouteBySessionId.get(session.id));
    if (
      !Number.isInteger(routeIndex)
      || routeIndex <= 0
      || reservedRouteIndices.has(routeIndex)
      || usedRouteIndices.has(routeIndex)
    ) {
      maxRouteIndex += 1;
      routeIndex = maxRouteIndex;
      changed = true;
    }
    usedRouteIndices.add(routeIndex);
    routeIndexBySessionId.set(session.id, routeIndex);
    if (session.id) {
      const autoImportedTitle = routeTitleBySessionId.get(session.id);
      const existingOrigin = config.chat[String(routeIndex)]?.origin;
      const sessionOrigin = session.origin;
      const nextRecord = {
        ...(config.chat[String(routeIndex)] || {}),
        sessionId: session.id,
        title: autoImportedTitle
          || session.title
          || session.summary
          || session.name
          || config.chat[String(routeIndex)]?.title,
        provider,
      };
      if (parseManualSessionRouteIndex(session.id) && typeof session.providerSessionId === 'string' && session.providerSessionId.trim()) {
        nextRecord.providerSessionId = session.providerSessionId.trim();
      }
      if (existingOrigin === SESSION_ORIGIN_MANUAL || existingOrigin === SESSION_ORIGIN_WORKFLOW) {
        nextRecord.origin = existingOrigin;
      } else if (sessionOrigin === SESSION_ORIGIN_MANUAL || sessionOrigin === SESSION_ORIGIN_WORKFLOW) {
        nextRecord.origin = sessionOrigin;
      } else {
        delete nextRecord.origin;
      }
      if (autoImportedTitle) {
        nextRecord.titleSource = AUTO_IMPORTED_ROUTE_TITLE_SOURCE;
      }
      if (config.chat[String(routeIndex)]?.ui && Object.keys(config.chat[String(routeIndex)].ui).length > 0) {
        nextRecord.ui = config.chat[String(routeIndex)].ui;
      }
      if (JSON.stringify(config.chat[String(routeIndex)] || {}) !== JSON.stringify(nextRecord)) {
        config.chat[String(routeIndex)] = nextRecord;
        changed = true;
      }
    }
  });
  const indexedSessions = sessions.map((session) => {
    if (!session?.id) {
      return session;
    }
    const routeIndex = routeIndexBySessionId.get(session.id);
    const routeRecord = Number.isInteger(routeIndex) ? config.chat[String(routeIndex)] : null;
    return {
      ...session,
      routeIndex,
      routeTitle: typeof routeRecord?.title === 'string' && routeRecord.title.trim()
        ? routeRecord.title.trim()
        : undefined,
    };
  });
  return {
    sessions: indexedSessions,
    changed,
  };
}
function getCustomDisplayName(config, projectName, projectPath) {
  const normalizedPath = normalizeComparablePath(projectPath);
  const displayNameByPath = getDisplayNameByPathMap(config);
  const byPath = normalizedPath ? displayNameByPath[normalizedPath] : null;
  if (typeof byPath === 'string' && byPath.trim()) {
    return byPath.trim();
  }
  const byProjectName = config?.[projectName]?.displayName;
  if (typeof byProjectName === 'string' && byProjectName.trim()) {
    return byProjectName.trim();
  }
  return null;
}
function resolveProjectDisplayName(config, projectName, projectPath, fallbackDisplayName) {
  const customDisplayName = getCustomDisplayName(config, projectName, projectPath);
  if (customDisplayName) {
    return {
      displayName: customDisplayName,
      isCustomName: true
    };
  }
  return {
    displayName: fallbackDisplayName,
    isCustomName: false
  };
}
function isMissingProjectPathError(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}
async function validateProjectPathAvailability(projectPath, options = {}) {
  if (!projectPath || typeof projectPath !== 'string') {
    return {
      exists: false,
      shouldArchive: false,
      errorCode: 'INVALID_PATH',
    };
  }
  const accessFn = options.access || fs.access;
  try {
    await accessFn(projectPath);
    return {
      exists: true,
      shouldArchive: false,
      errorCode: null,
    };
  } catch (error) {
    return {
      exists: false,
      shouldArchive: isMissingProjectPathError(error),
      errorCode: error?.code || 'UNKNOWN',
    };
  }
}
async function evaluateProjectArchival({
  projectPath,
  source,
  archiveIndex,
  options = {}
}) {
  const normalizedPath = normalizeComparablePath(projectPath);
  if (!normalizedPath) {
    return {
      excludeFromList: false,
      archiveUpdated: false,
      reason: 'invalid-path',
      normalizedPath: '',
    };
  }
  const normalizedArchive = normalizeProjectArchiveIndex(archiveIndex);
  const availability = await validateProjectPathAvailability(projectPath, options);
  if (normalizedArchive.archivedProjects[normalizedPath]) {
    if (availability.exists || !availability.shouldArchive) {
      delete normalizedArchive.archivedProjects[normalizedPath];
      return {
        excludeFromList: false,
        archiveUpdated: true,
        reason: availability.exists ? 'archive-cleared-path-exists' : 'archive-cleared-non-archive-error',
        normalizedPath,
      };
    }
    return {
      excludeFromList: true,
      archiveUpdated: false,
      reason: 'already-archived',
      normalizedPath,
    };
  }
  if (availability.exists) {
    return {
      excludeFromList: false,
      archiveUpdated: false,
      reason: 'path-exists',
      normalizedPath,
    };
  }
  if (!availability.shouldArchive) {
    return {
      excludeFromList: false,
      archiveUpdated: false,
      reason: 'non-archive-error',
      normalizedPath,
    };
  }
  const timestamp = options.now instanceof Date
    ? options.now.toISOString()
    : new Date().toISOString();
  normalizedArchive.archivedProjects[normalizedPath] = {
    normalizedPath,
    path: projectPath,
    source,
    reason: 'path-missing',
    archivedAt: timestamp,
    lastCheckedAt: timestamp,
    errorCode: availability.errorCode,
  };
  return {
    excludeFromList: true,
    archiveUpdated: true,
    reason: 'archived-missing-path',
    normalizedPath,
  };
}
async function generateDisplayName(projectName, actualProjectDir = null) {
  const projectPath = actualProjectDir || projectName.replace(/-/g, '/');
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    return parts[parts.length - 1] || projectPath;
  }
  return projectPath;
}
async function extractProjectDirectory(projectName) {
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }
  const config = await loadProjectConfig();
  if (config[projectName]?.originalPath) {
    const originalPath = config[projectName].originalPath;
    projectDirectoryCache.set(projectName, originalPath);
    return originalPath;
  }
  const extractedPath = projectName.replace(/-/g, '/');
  projectDirectoryCache.set(projectName, extractedPath);
  return extractedPath;
}
function mergeWorktreeProjects(projects) {
  const WORKTREE_SEGMENT = '/.worktrees/';
  const parentMap = new Map(); // parentPath -> project index
  const worktreeIndices = [];
  for (let i = 0; i < projects.length; i++) {
    const projectPath = projects[i].path || projects[i].fullPath || '';
    if (projectPath.includes(WORKTREE_SEGMENT)) {
      worktreeIndices.push(i);
    } else {
      parentMap.set(normalizeComparablePath(projectPath), i);
    }
  }
  if (worktreeIndices.length === 0) {
    return;
  }
  const toRemove = new Set();
  for (const wtIdx of worktreeIndices) {
    const wtProject = projects[wtIdx];
    const wtPath = wtProject.path || wtProject.fullPath || '';
    const parentPath = wtPath.substring(0, wtPath.indexOf(WORKTREE_SEGMENT));
    const normalizedParent = normalizeComparablePath(parentPath);
    const parentIdx = parentMap.get(normalizedParent);
    if (parentIdx === undefined) {
      continue;
    }
    const parent = projects[parentIdx];
    const branchName = wtPath.substring(wtPath.indexOf(WORKTREE_SEGMENT) + WORKTREE_SEGMENT.length);
    if (wtProject.sessions?.length > 0) {
      const taggedSessions = wtProject.sessions.map(s => ({
        ...s,
        worktreeBranch: branchName,
        __projectName: s.__projectName || wtProject.name,
      }));
      parent.sessions = [...(parent.sessions || []), ...taggedSessions];
      parent.sessionMeta = {
        ...parent.sessionMeta,
        total: (parent.sessionMeta?.total || 0) + (wtProject.sessionMeta?.total || 0),
      };
    }
    for (const key of ['codexSessions', 'piSessions']) {
      if (wtProject[key]?.length > 0) {
        parent[key] = [
          ...(parent[key] || []),
          ...wtProject[key].map((session) => ({
            ...session,
            __projectName: session.__projectName || wtProject.name,
          })),
        ];
      }
    }
    toRemove.add(wtIdx);
  }
  const sortedRemove = [...toRemove].sort((a, b) => b - a);
  for (const idx of sortedRemove) {
    projects.splice(idx, 1);
  }
}
function isGoTestTempProjectPath(projectPath) {
  const relativeToTmp = path.relative(os.tmpdir(), path.resolve(String(projectPath || '')));
  if (!relativeToTmp || relativeToTmp.startsWith('..') || path.isAbsolute(relativeToTmp)) {
    return false;
  }
  const segments = relativeToTmp.split(path.sep).filter(Boolean);
  return segments.length >= 2 && /^Test[^/\\]+$/.test(segments[0]) && /^\d+$/.test(segments[1]);
}
async function projectHasBusinessData(project) {
  if (project?.isManuallyAdded || project?.isCustomName) {
    return true;
  }
  if ((Array.isArray(project?.sessions) && project.sessions.length > 0)
    || (Array.isArray(project?.codexSessions) && project.codexSessions.length > 0)
    || (Array.isArray(project?.piSessions) && project.piSessions.length > 0)) {
    return true;
  }
  const workflows = await listProjectWorkflows(project?.fullPath || project?.path || '');
  return workflows.length > 0;
}
async function filterAndDisambiguateProjects(projects) {
  const kept = [];
  for (const project of projects) {
    const projectPath = project?.fullPath || project?.path || '';
    if (isGoTestTempProjectPath(projectPath) && !(await projectHasBusinessData(project))) {
      continue;
    }
    kept.push(project);
  }
  const byDisplayName = new Map();
  for (const project of kept) {
    const displayName = String(project.displayName || project.name || '').trim();
    byDisplayName.set(displayName, [...(byDisplayName.get(displayName) || []), project]);
  }
  for (const [displayName, sameNameProjects] of byDisplayName.entries()) {
    if (!displayName || sameNameProjects.length < 2) {
      continue;
    }
    for (const project of sameNameProjects) {
      if (project.isCustomName) {
        continue;
      }
      const projectPath = project.fullPath || project.path || '';
      const parentName = path.basename(path.dirname(projectPath));
      project.displayName = parentName ? `${displayName} - ${parentName}` : displayName;
    }
  }
  return kept;
}
export const __projectDiscoveryForTest = {
  filterAndDisambiguateProjects,
  isGoTestTempProjectPath,
};
type ProjectOverviewRecord = {
  fullPath?: string;
  path?: string;
  isManuallyAdded?: boolean;
  codexSessions: Array<Record<string, any>>;
  piSessions: Array<Record<string, any>>;
  [key: string]: any;
};
type GetProjectsOptions = {
  lightweightList?: boolean;
};
async function getProjects(
  progressCallback: ((message: Record<string, unknown>) => void) | null = null,
  options: GetProjectsOptions = {},
): Promise<ProjectOverviewRecord[]> {
  const lightweightList = options.lightweightList === true;
  const cachedSnapshot = projectsSnapshotCache;
  if (!lightweightList && cachedSnapshot && Date.now() < cachedSnapshot.expiresAt) {
    if (progressCallback) {
      progressCallback({ phase: 'complete', current: cachedSnapshot.value.length, total: cachedSnapshot.value.length });
    }
    return cloneProjectsSnapshot(cachedSnapshot.value);
  }
  const config = await loadProjectConfig();
  const projectArchiveIndex = await loadProjectArchiveIndex();
  const projects = [];
  const existingProjects = new Set();
  const knownProjectPaths = new Set();
  const usedProjectNames = new Set();
  const codexSessionsIndexRef = { sessionsByProject: null };
  const piSessionsIndexRef = { sessionsByProject: null };
  let archiveIndexChanged = false;
  let providerOnlyProjectCount = 0;
  let totalProjects = 0;
  let processedProjects = 0;
  if (!lightweightList) {
    await hydrateProviderIndexesForHomeOverview({
      codex: codexSessionsIndexRef,
      pi: piSessionsIndexRef,
    });
  }
    const shouldSkipProject = async (projectPath, source) => {
    const archiveDecision = await evaluateProjectArchival({
      projectPath,
      source,
      archiveIndex: projectArchiveIndex,
    });
    if (archiveDecision.archiveUpdated) {
      archiveIndexChanged = true;
    }
    return archiveDecision.excludeFromList;
  };
  totalProjects = Object.entries(config)
    .filter(([name, cfg]) => cfg.manuallyAdded && !existingProjects.has(name))
    .length;
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!existingProjects.has(projectName) && projectConfig.manuallyAdded) {
      processedProjects++;
      if (progressCallback) {
        progressCallback({
          phase: 'loading',
          current: processedProjects,
          total: totalProjects,
          currentProject: projectName
        });
      }
      let actualProjectDir = projectConfig.originalPath;
      if (!actualProjectDir) {
        try {
          actualProjectDir = await extractProjectDirectory(projectName);
        } catch (error) {
          actualProjectDir = projectName.replace(/-/g, '/');
        }
      }
      if (await shouldSkipProject(actualProjectDir, 'manual')) {
        continue;
      }
      const autoDisplayName = await generateDisplayName(projectName, actualProjectDir);
      const resolvedDisplayName = resolveProjectDisplayName(
        config,
        projectName,
        actualProjectDir,
        autoDisplayName
      );
      const project = {
        name: projectName,
        path: actualProjectDir,
        routePath: buildProjectRoutePath(actualProjectDir),
        displayName: resolvedDisplayName.displayName,
        fullPath: actualProjectDir,
        isCustomName: resolvedDisplayName.isCustomName,
        isManuallyAdded: true,
        sessions: [],
        sessionMeta: {
          hasMore: false,
          total: 0
        },
        codexSessions: [],
        piSessions: []
      };
      if (!lightweightList) {
        try {
          project.codexSessions = await getCodexSessions(actualProjectDir, {
            limit: PROJECT_OVERVIEW_SESSION_LIMIT,
            indexRef: codexSessionsIndexRef,
            includeHidden: true,
            excludeWorkflowChildSessions: true,
          });
        } catch (e) {
          console.warn(`Could not load Codex sessions for manual project ${projectName}:`, e.message);
        }
        try {
          project.piSessions = await getPiSessions(actualProjectDir, {
            indexRef: piSessionsIndexRef,
            includeHidden: true,
            excludeWorkflowChildSessions: true,
          });
        } catch (e) {
          console.warn(`Could not load Pi sessions for manual project ${projectName}:`, e.message);
        }
        await attachManualSessionNextRouteIndex(project, actualProjectDir);
      }
      usedProjectNames.add(project.name);
      const normalizedProjectPath = normalizeComparablePath(actualProjectDir);
      if (normalizedProjectPath) {
        knownProjectPaths.add(normalizedProjectPath);
      }
      projects.push(project);
    }
  }
  const collectProviderOnlyCandidates = (provider, indexRef) => [...indexRef.sessionsByProject.entries()]
    .map(([normalizedProjectPath, providerSessions]) => ({
      provider,
      normalizedProjectPath,
      providerSessions,
      lastActivity: providerSessions
        .map((session) => new Date(session?.lastActivity || session?.updated_at || session?.createdAt || 0).getTime())
        .filter(Number.isFinite)
        .sort((left, right) => right - left)[0] || 0,
    }));
  const providerOnlyCandidates = lightweightList
    ? await collectLightweightProviderOnlyCandidates()
    : [
      ...collectProviderOnlyCandidates('codex', codexSessionsIndexRef),
      ...collectProviderOnlyCandidates('pi', piSessionsIndexRef),
    ].sort((left, right) => right.lastActivity - left.lastActivity);
  for (const { provider, normalizedProjectPath, providerSessions } of providerOnlyCandidates) {
    if (providerOnlyProjectCount >= PROVIDER_ONLY_PROJECT_LIMIT) {
      break;
    }
    if (!normalizedProjectPath || knownProjectPaths.has(normalizedProjectPath)) {
      continue;
    }
    const inferredProjectPath = providerSessions?.[0]?.cwd || providerSessions?.[0]?.projectPath || normalizedProjectPath;
    if (await shouldSkipProject(inferredProjectPath, provider)) {
      continue;
    }
    const projectName = createLiveProjectName(inferredProjectPath, usedProjectNames, provider);
    const autoDisplayName = await generateDisplayName(projectName, inferredProjectPath);
    const resolvedDisplayName = resolveProjectDisplayName(config, projectName, inferredProjectPath, autoDisplayName);
    const project = {
      name: projectName,
      path: inferredProjectPath,
      routePath: buildProjectRoutePath(inferredProjectPath),
      displayName: resolvedDisplayName.displayName,
      fullPath: inferredProjectPath,
      isCustomName: resolvedDisplayName.isCustomName,
      sessions: [],
      codexSessions: [],
      piSessions: [],
      sessionMeta: {
        hasMore: false,
        total: 0,
      },
    };
    if (!lightweightList) {
      [project.codexSessions, project.piSessions] = await Promise.all([
        getCodexSessions(inferredProjectPath, {
          limit: PROJECT_OVERVIEW_SESSION_LIMIT,
          indexRef: codexSessionsIndexRef,
          includeHidden: true,
          excludeWorkflowChildSessions: true,
        }).catch(() => []),
        getPiSessions(inferredProjectPath, {
          indexRef: piSessionsIndexRef,
          includeHidden: true,
          excludeWorkflowChildSessions: true,
        }).catch(() => []),
      ]);
      await attachManualSessionNextRouteIndex(project, inferredProjectPath);
    }
    projects.push(project);
    providerOnlyProjectCount++;
    usedProjectNames.add(projectName);
    knownProjectPaths.add(normalizedProjectPath);
  }
  await mergeActiveProviderSessionsIntoProjects({
    projects,
    config,
    usedProjectNames,
    knownProjectPaths,
  });
  mergeWorktreeProjects(projects);
  if (archiveIndexChanged) {
    try {
      await saveProjectArchiveIndex(projectArchiveIndex);
    } catch (error) {
      console.warn('Failed to persist project archive index:', error.message);
    }
  }
  if (progressCallback) {
    progressCallback({
      phase: 'complete',
      current: totalProjects,
      total: totalProjects
    });
  }
  const filteredProjects = await filterAndDisambiguateProjects(projects);
  if (!lightweightList) {
    projectsSnapshotCache = {
      value: cloneProjectsSnapshot(filteredProjects),
      expiresAt: Date.now() + PROJECTS_CACHE_TTL_MS,
    };
  }
  return filteredProjects;
}
async function getSessions(projectName, limit = 5, offset = 0, options = {}) {
  void projectName;
  void options;
  return {
    sessions: [],
    hasMore: false,
    total: 0,
    offset,
    limit,
  };
}
async function parseJsonlSessions(filePath) {
  const sessions = new Map();
  const entries = [];
  const pendingSummaries = new Map(); // leafUuid -> summary for entries without sessionId
  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);
          if (entry.type === 'summary' && entry.summary && !entry.sessionId && entry.leafUuid) {
            pendingSummaries.set(entry.leafUuid, entry.summary);
          }
          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              const entryDate = entry.timestamp ? new Date(entry.timestamp) : null;
              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: 'New Session',
                messageCount: 0,
                createdAt: entryDate,
                lastActivity: entryDate,
                cwd: entry.cwd || '',
                firstUserMessage: null,
                lastAssistantMessage: null
              });
            }
            const session = sessions.get(entry.sessionId);
            if (session.summary === 'New Session' && entry.parentUuid && pendingSummaries.has(entry.parentUuid)) {
              session.summary = pendingSummaries.get(entry.parentUuid);
            }
            if (entry.type === 'summary' && entry.summary) {
              session.summary = entry.summary;
            }
            if (entry.message?.role === 'user' && entry.message?.content) {
              const content = entry.message.content;
              let textContent = content;
              if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
                textContent = content[0].text;
              }
              const isSystemMessage = typeof textContent === 'string' && (
                textContent.startsWith('<command-name>') ||
                textContent.startsWith('<command-message>') ||
                textContent.startsWith('<command-args>') ||
                textContent.startsWith('<local-command-stdout>') ||
                textContent.startsWith('<system-reminder>') ||
                textContent.startsWith('Caveat:') ||
                textContent.startsWith('This session is being continued from a previous') ||
                textContent.startsWith('Invalid API key') ||
                textContent.includes('{"subtasks":') || // Filter Task Master prompts
                textContent.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                isBootstrapSessionPrompt(textContent)
              );
              if (typeof textContent === 'string' && textContent.length > 0 && !isSystemMessage) {
                session.firstUserMessage = session.firstUserMessage || textContent;
              }
            } else if (entry.message?.role === 'assistant' && entry.message?.content) {
              if (entry.isApiErrorMessage === true) {
              } else {
                let assistantText = null;
                if (Array.isArray(entry.message.content)) {
                  for (const part of entry.message.content) {
                    if (part.type === 'text' && part.text) {
                      assistantText = part.text;
                    }
                  }
                } else if (typeof entry.message.content === 'string') {
                  assistantText = entry.message.content;
                }
                const isSystemAssistantMessage = typeof assistantText === 'string' && (
                  assistantText.startsWith('Invalid API key') ||
                  assistantText.includes('{"subtasks":') ||
                  assistantText.includes('CRITICAL: You MUST respond with ONLY a JSON')
                );
                if (assistantText && !isSystemAssistantMessage) {
                  session.lastAssistantMessage = assistantText;
                }
              }
            }
            session.messageCount++;
            if (entry.timestamp) {
              const entryDate = new Date(entry.timestamp);
              if (!Number.isNaN(entryDate.getTime())) {
                const createdAtTime = new Date(session.createdAt || 0).getTime();
                if (!Number.isFinite(createdAtTime) || createdAtTime <= 0) {
                  session.createdAt = entryDate;
                }
                session.lastActivity = entryDate;
              }
            }
          }
        } catch (parseError) {
        }
      }
    }
    for (const session of sessions.values()) {
      if (session.summary === 'New Session') {
        const defaultSummary = session.firstUserMessage || session.lastAssistantMessage;
        if (defaultSummary) {
          session.summary = defaultSummary.length > 50 ? defaultSummary.substring(0, 50) + '...' : defaultSummary;
        }
      }
    }
    const allSessions = Array.from(sessions.values());
    const filteredSessions = allSessions.filter(session => {
      const shouldFilter = session.summary.startsWith('{ "');
      if (shouldFilter) {
      }
      if (Math.random() < 0.01) { // Log 1% of sessions
      }
      return !shouldFilter;
    });
    return {
      sessions: filteredSessions,
      entries: entries
    };
  } catch (error) {
    console.error('Error reading JSONL file:', error);
    return { sessions: [], entries: [] };
  }
}
function isBootstrapSessionPrompt(text) {
  if (typeof text !== 'string') {
    return false;
  }
  const normalized = text.trim().toLowerCase();
  return normalized === 'warmup' || normalized === 'ping';
}
async function parseAgentTools(filePath) {
  const tools = [];
  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          if (entry.message?.role === 'assistant' && Array.isArray(entry.message?.content)) {
            for (const part of entry.message.content) {
              if (part.type === 'tool_use') {
                tools.push({
                  toolId: part.id,
                  toolName: part.name,
                  toolInput: part.input,
                  timestamp: entry.timestamp
                });
              }
            }
          }
          if (entry.message?.role === 'user' && Array.isArray(entry.message?.content)) {
            for (const part of entry.message.content) {
              if (part.type === 'tool_result') {
                const tool = tools.find(t => t.toolId === part.tool_use_id);
                if (tool) {
                  tool.toolResult = {
                    content: typeof part.content === 'string' ? part.content :
                      Array.isArray(part.content) ? part.content.map(c => c.text || '').join('\n') :
                        JSON.stringify(part.content),
                    isError: Boolean(part.is_error)
                  };
                }
              }
            }
          }
        } catch (parseError) {
        }
      }
    }
  } catch (error) {
    console.warn(`Error parsing agent file ${filePath}:`, error.message);
  }
  return tools;
}
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0, afterLine = null) {
  void projectName;
  void sessionId;
  void limit;
  void offset;
  void afterLine;
  throw new Error('Claude session history is no longer supported');
}
async function findClaudeSessionFile(projectName, sessionId) {
  void projectName;
  void sessionId;
  throw new Error('Claude session history is no longer supported');
}
async function renameProject(projectName, newDisplayName, projectPath = null) {
  const config = await loadProjectConfig();
  const normalizedPath = normalizeComparablePath(projectPath);
  if (!config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] || typeof config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] !== 'object') {
    config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] = {};
  }
  const displayNameByPath = config[PROJECT_DISPLAY_NAME_BY_PATH_KEY];
  if (!newDisplayName || newDisplayName.trim() === '') {
    if (config[projectName] && typeof config[projectName] === 'object') {
      delete config[projectName].displayName;
      if (Object.keys(config[projectName]).length === 0) {
        delete config[projectName];
      }
    } else {
      delete config[projectName];
    }
    if (normalizedPath) {
      delete displayNameByPath[normalizedPath];
    }
  } else {
    const trimmedDisplayName = newDisplayName.trim();
    if (!config[projectName] || typeof config[projectName] !== 'object') {
      config[projectName] = {};
    }
    config[projectName] = {
      ...config[projectName],
      displayName: trimmedDisplayName
    };
    if (normalizedPath) {
      displayNameByPath[normalizedPath] = trimmedDisplayName;
    }
  }
  if (Object.keys(displayNameByPath).length === 0) {
    delete config[PROJECT_DISPLAY_NAME_BY_PATH_KEY];
  }
  await saveProjectConfig(config);
  clearProjectDirectoryCache();
  return true;
}
async function updateSessionUiState(projectName, sessionId, provider = 'codex', uiState = {}, projectPathOverride = '') {
  const normalizedProvider = provider === 'pi' ? 'pi' : 'codex';
  const projectPath = typeof projectPathOverride === 'string' && projectPathOverride.trim()
    ? projectPathOverride.trim()
    : await extractProjectDirectory(projectName);
  const stateKey = buildSessionUiStateKey(projectPath, normalizedProvider, sessionId);
  if (!stateKey) {
    throw new Error('Project path and session id are required to update session UI state');
  }
  const config = await loadProjectConfig(projectPath);
  const nextEntry = {};
  if (uiState.favorite === true) {
    nextEntry.favorite = true;
  }
  if (uiState.pending === true) {
    nextEntry.pending = true;
  }
  if (uiState.hidden === true) {
    nextEntry.hidden = true;
  }
  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const location = findProjectChatRecord(config, sessionId, normalizedProvider);
    if (location) {
      writeProjectChatRecordUiState(location.record, normalizedProvider, nextEntry);
      deleteConfigMapEntry(config, SESSION_UI_STATE_BY_PATH_KEY, stateKey);
      await saveProjectConfig(config, projectPath);
      return nextEntry;
    }
  }
  if (!config[SESSION_UI_STATE_BY_PATH_KEY] || typeof config[SESSION_UI_STATE_BY_PATH_KEY] !== 'object') {
    config[SESSION_UI_STATE_BY_PATH_KEY] = {};
  }
  if (Object.keys(nextEntry).length === 0) {
    delete config[SESSION_UI_STATE_BY_PATH_KEY][stateKey];
  } else {
    config[SESSION_UI_STATE_BY_PATH_KEY][stateKey] = nextEntry;
  }
  if (Object.keys(config[SESSION_UI_STATE_BY_PATH_KEY]).length === 0) {
    delete config[SESSION_UI_STATE_BY_PATH_KEY];
  }
  await saveProjectConfig(config, projectPath);
  return nextEntry;
}
async function renameSession(projectName, sessionId, newSummary, projectPath = '') {
  void projectName;
  void sessionId;
  void projectPath;
  const trimmedSummary = typeof newSummary === 'string' ? newSummary.trim() : '';
  if (!trimmedSummary) {
    throw new Error('Session summary is required');
  }
  throw new Error('Claude sessions are no longer supported');
}
async function renameCodexSession(sessionId, newSummary, projectPath = '') {
  const trimmedSummary = typeof newSummary === 'string' ? newSummary.trim() : '';
  if (!trimmedSummary) {
    throw new Error('Session summary is required');
  }
  const config = await loadProjectConfig(projectPath);
  writeSessionSummaryOverride(config, sessionId, trimmedSummary);
  const chatRecord = findProjectChatRecord(config, sessionId);
  if (chatRecord?.record) {
    chatRecord.record.title = trimmedSummary;
    delete chatRecord.record.titleSource;
  }
  await saveProjectConfig(config, projectPath);
  clearProjectDirectoryCache();
  return true;
}
async function createManualSessionDraft(projectName, projectPath, provider = 'codex', label, options = {}) {
    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  if (!trimmedLabel) {
    throw new Error('Session label is required');
  }
  const workflowId = typeof options?.workflowId === 'string' ? options.workflowId.trim() : '';
  const stageKey = typeof options?.stageKey === 'string' ? options.stageKey.trim() : '';
  const requestedRouteIndex = Number(options?.routeIndex);
  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  let config = await loadProjectConfig(resolvedProjectPath);
  let currentStandaloneSessionCount = null;
  if (!workflowId) {
    if (provider !== 'codex' && provider !== 'pi') {
      throw new Error('provider must be "codex" or "pi"');
    }
    const [codexSessions, piSessions] = await Promise.all([
      getCodexSessions(resolvedProjectPath, { limit: 0, includeHidden: true, excludeWorkflowChildSessions: true }),
      getPiSessions(resolvedProjectPath, {
        limit: 0,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
      }),
    ]);
    config = await loadProjectConfig(resolvedProjectPath);
    const providerRouteMax = [...codexSessions, ...piSessions].reduce((maxValue, session) => {
      const parsed = Number(session?.routeIndex) || parseManualSessionRouteIndex(session?.id);
      return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
    }, 0);
    currentStandaloneSessionCount = Math.max(
      providerRouteMax,
      codexSessions.length + piSessions.length,
    );
  }
  const computedRouteIndex = !workflowId && Number.isInteger(currentStandaloneSessionCount)
    ? getNextManualSessionRouteIndex(config, resolvedProjectPath, currentStandaloneSessionCount)
    : undefined;
  const nextRouteIndex = workflowId
    ? undefined
    : Number.isInteger(requestedRouteIndex) && requestedRouteIndex >= Number(computedRouteIndex || 1)
      ? requestedRouteIndex
      : Number.isInteger(computedRouteIndex)
      ? computedRouteIndex
      : undefined;
  const manualDraftMapBeforeCreate = getManualSessionDraftMap(config);
  const existingDraftIds = new Set([
    ...Object.keys(manualDraftMapBeforeCreate),
    ...Object.values(manualDraftMapBeforeCreate).map((draft) => draft?.id).filter(Boolean),
  ]);
  let draftRouteIndex = nextRouteIndex;
  const draftId = buildManualSessionId(draftRouteIndex)
    || `new-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (existingDraftIds.has(draftId) || findProjectChatRecord(config, draftId)?.record) {
    throw new Error(`Manual session route already exists: ${draftId}`);
  }
  const createdAt = new Date().toISOString();
  const manualDraftMap = {
    ...getManualSessionDraftMap(config),
    [draftId]: {
      provider,
      label: trimmedLabel,
      projectName,
      projectPath: resolvedProjectPath,
      createdAt,
      updatedAt: createdAt,
      workflowId: workflowId || undefined,
      stageKey: stageKey || undefined,
      origin: workflowId ? SESSION_ORIGIN_WORKFLOW : SESSION_ORIGIN_MANUAL,
    },
  };
  config[MANUAL_SESSION_DRAFTS_KEY] = manualDraftMap;
  if (!workflowId) {
    writeManualSessionRouteCounter(config, resolvedProjectPath, nextRouteIndex);
  }
  await saveProjectConfig(config, resolvedProjectPath);
  return buildManualDraftSession({
    ...manualDraftMap[draftId],
    id: draftId,
  });
}
async function initManualSessionRoute(projectName, projectPath, draftSessionId, provider = 'codex') {
  return initManualSessionRouteInStore(projectName, projectPath, draftSessionId, provider, getSessionRouteStoreDependencies());
}
async function bindManualSessionProvider(projectName, projectPath, draftSessionId, providerSessionId) {
  return bindManualSessionProviderInStore(projectName, projectPath, draftSessionId, providerSessionId, getSessionRouteStoreDependencies());
}
async function getManualSessionRouteRuntime(projectName, projectPath, draftSessionId) {
  if (typeof draftSessionId !== 'string' || !draftSessionId.trim()) {
    return null;
  }
  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedProjectPath);
  let draftRecord = findProjectChatRecord(config, draftSessionId);
  if (!draftRecord?.record) {
    const routeIndex = parseManualSessionRouteIndex(draftSessionId);
    const routeRecord = Number.isInteger(routeIndex) && routeIndex > 0
      ? config?.chat?.[String(routeIndex)]
      : null;
    if (routeRecord) {
      draftRecord = { scope: 'chat', routeIndex: String(routeIndex), record: routeRecord };
    }
  }
  if (!draftRecord?.record) {
    return null;
  }
  const record = draftRecord.record;
  const routeSessionId = buildManualSessionId(Number(draftRecord.routeIndex));
  const recordSessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
  const boundProviderSessionId = typeof record.providerSessionId === 'string'
    && record.providerSessionId.trim() !== routeSessionId
    ? record.providerSessionId.trim()
    : '';
  const resolvedProviderSessionId = boundProviderSessionId
    || (recordSessionId && recordSessionId !== routeSessionId ? recordSessionId : '');
  return {
    provider: record.provider || 'codex',
    routeInitToken: record.routeInitToken || '',
    providerSessionId: resolvedProviderSessionId,
    routeIndex: Number(draftRecord.routeIndex),
  };
}
async function finalizeManualSessionRoute(projectName, draftSessionId, actualSessionId, provider = 'codex', projectPath = '') {
  return finalizeManualSessionRouteInStore(projectName, draftSessionId, actualSessionId, provider, projectPath, getSessionRouteStoreDependencies());
}
async function deleteManualSessionDraft(sessionId, provider = null, projectPath = '') {
  const config = await loadProjectConfig(projectPath);
  const manualDraftMap = {
    ...getManualSessionDraftMap(config),
  };
  const rawDrafts = config[MANUAL_SESSION_DRAFTS_KEY];
  const rawDraft = rawDrafts && typeof rawDrafts === 'object' ? rawDrafts[sessionId] : null;
  const draft = manualDraftMap[sessionId] || rawDraft;
  if (!draft) {
    return false;
  }
  if (provider && draft.provider !== provider) {
    return false;
  }
  await cleanupDeletedSessionConfig(sessionId, projectPath, provider || draft.provider || null);
  clearProjectDirectoryCache();
  return true;
}
async function deleteSession(projectName, sessionId, provider = null) {
  try {
    const projectPath = await extractProjectDirectory(projectName);
    if (provider === 'pi') {
      return await deletePiSession(sessionId, projectPath);
    }
    const deletedDraft = await deleteManualSessionDraft(sessionId, null, projectPath);
    if (deletedDraft) {
      return true;
    }
    const config = await loadProjectConfig(projectPath);
    if (getPiProviderSessionIdForDelete(config, sessionId)) {
      return await deletePiSession(sessionId, projectPath);
    }
    await deleteCodexSession(sessionId, projectPath);
    return true;
  } catch (error) {
    console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}
function getPiProviderSessionIdForDelete(config, sessionId) {
  for (const [routeIndex, record] of Object.entries(config?.chat || {})) {
    if (!record || record.provider !== 'pi') {
      continue;
    }
    const routeSessionId = Number.isInteger(Number(routeIndex)) && Number(routeIndex) > 0
      ? buildManualSessionId(Number(routeIndex))
      : '';
    if (routeSessionId !== sessionId && record.sessionId !== sessionId && record.providerSessionId !== sessionId) {
      continue;
    }
    if (typeof record.providerSessionId === 'string' && record.providerSessionId.trim()) {
      return record.providerSessionId.trim();
    }
    if (!parseManualSessionRouteIndex(record.sessionId) && typeof record.sessionId === 'string') {
      return record.sessionId.trim();
    }
  }
  return '';
}
async function deletePiSession(sessionId, projectPath = '') {
  try {
    const config = await loadProjectConfig(projectPath);
    const providerSessionId = getPiProviderSessionIdForDelete(config, sessionId);
    let deleted = false;
    await cleanupDeletedSessionConfig(sessionId, projectPath, 'pi');
    if (providerSessionId && providerSessionId !== sessionId) {
      await cleanupDeletedSessionConfig(providerSessionId, projectPath, 'pi');
    }
    const sessionFilePath = await findPiSessionFilePath(providerSessionId || sessionId);
    if (sessionFilePath) {
      await fs.unlink(sessionFilePath);
      await deleteProviderSessionIndexFile('pi', sessionFilePath);
      deleted = true;
    }
    clearProjectDirectoryCache();
    if (deleted || providerSessionId || parseManualSessionRouteIndex(sessionId)) {
      return true;
    }
    throw new Error(`Pi session file not found for session ${sessionId}`);
  } catch (error) {
    console.error(`Error deleting Pi session ${sessionId}:`, error);
    throw error;
  }
}
function hasManualDraftsForProject(config, { projectName, projectPath, localProjectConfig = false } = {}) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  return Object.values(getManualSessionDraftMap(config)).some((draft) => {
    if (!draft || typeof draft !== 'object' || isWorkflowOwnedDraft(draft)) {
      return false;
    }
    if (draft.provider !== 'codex' && draft.provider !== 'pi') {
      return false;
    }
    if (localProjectConfig && !draft.projectName && !draft.projectPath) {
      return true;
    }
    return draft.projectName === projectName
      || normalizeComparablePath(draft.projectPath) === normalizedProjectPath;
  });
}
async function resolveProjectPathForDeletion(config, projectName, projectPathHint = '') {
  /**
   * PURPOSE: Delete manual projects by their configured path, while allowing
   * provider-only projects to use the real path carried by the sidebar payload.
   */
  const configuredPath = config[projectName]?.path || config[projectName]?.originalPath || '';
  if (configuredPath) {
    return configuredPath;
  }
  const hintedPath = typeof projectPathHint === 'string' ? projectPathHint.trim() : '';
  if (hintedPath) {
    return hintedPath;
  }
  try {
    const discoveredProject = (await getProjects(null, { lightweightList: true })).find((project) => (
      project.name === projectName
      || project.routePath === projectName
    ));
    const discoveredPath = discoveredProject?.fullPath || discoveredProject?.path || '';
    if (discoveredPath) {
      return discoveredPath;
    }
  } catch (error) {
    console.warn(`Could not resolve provider-only project path for ${projectName}:`, error.message);
  }
  return extractProjectDirectory(projectName);
}
async function isProjectEmpty(projectName, projectPathHint = '') {
  try {
    const config = await loadProjectConfig();
    const projectPath = await resolveProjectPathForDeletion(config, projectName, projectPathHint);
    if (hasManualDraftsForProject(config, { projectName, projectPath })) {
      return false;
    }
    if (!projectPath) {
      return true;
    }
    const projectLocalConfig = await loadProjectConfig(projectPath);
    if (hasManualDraftsForProject(projectLocalConfig, {
      projectName,
      projectPath,
      localProjectConfig: true,
    })) {
      return false;
    }
    const codexSessions = await getCodexSessions(projectPath, { limit: 1, includeHidden: true });
    if (codexSessions.length > 0) {
      return false;
    }
    const piSessions = await getPiSessions(projectPath);
    return piSessions.length === 0;
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}
async function deleteProject(projectName, force = false, projectPathHint = '') {
  try {
    if (!force) {
      const isEmpty = await isProjectEmpty(projectName, projectPathHint);
      if (!isEmpty) {
        throw new Error('Cannot delete project with existing sessions');
      }
    }
    const config = await loadProjectConfig();
    const projectPath = await resolveProjectPathForDeletion(config, projectName, projectPathHint);
    if (projectPath) {
      try {
        const codexSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
        for (const session of codexSessions) {
          try {
            await deleteCodexSession(session.id, projectPath);
          } catch (err) {
            console.warn(`Failed to delete Codex session ${session.id}:`, err.message);
          }
        }
      } catch (err) {
        console.warn('Failed to delete Codex sessions:', err.message);
      }
      try {
        const piSessions = await getPiSessions(projectPath, { limit: 0, includeHidden: true });
        for (const session of piSessions) {
          try {
            await deletePiSession(session.id, projectPath);
          } catch (err) {
            console.warn(`Failed to delete Pi session ${session.id}:`, err.message);
          }
        }
      } catch (err) {
        console.warn('Failed to delete Pi sessions:', err.message);
      }
    }
    delete config[projectName];
    const normalizedProjectPath = normalizeComparablePath(projectPath);
    const manualDraftMap = {
      ...getManualSessionDraftMap(config),
    };
    Object.entries(manualDraftMap).forEach(([draftId, draft]) => {
      const belongsToProject = draft?.projectName === projectName
        || normalizeComparablePath(draft?.projectPath) === normalizedProjectPath;
      if (belongsToProject) {
        delete manualDraftMap[draftId];
      }
    });
    if (Object.keys(manualDraftMap).length === 0) {
      delete config[MANUAL_SESSION_DRAFTS_KEY];
    } else {
      config[MANUAL_SESSION_DRAFTS_KEY] = manualDraftMap;
    }
    if (
      normalizedProjectPath &&
      config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] &&
      typeof config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] === 'object'
    ) {
      delete config[PROJECT_DISPLAY_NAME_BY_PATH_KEY][normalizedProjectPath];
      if (Object.keys(config[PROJECT_DISPLAY_NAME_BY_PATH_KEY]).length === 0) {
        delete config[PROJECT_DISPLAY_NAME_BY_PATH_KEY];
      }
    }
    await saveProjectConfig(config);
    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}
async function addProjectManually(projectPath, displayName = null) {
  const absolutePath = path.resolve(projectPath);
  try {
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }
  const projectName = absolutePath.replace(/[\\/:\s~_]/g, '-');
  const config = await loadProjectConfig();
  if (config[projectName]) {
    throw new Error(`Project already configured for path: ${absolutePath}`);
  }
  config[projectName] = {
    manuallyAdded: true,
    originalPath: absolutePath
  };
  if (displayName) {
    config[projectName].displayName = displayName;
  }
  await saveProjectConfig(config);
  return {
    name: projectName,
    path: absolutePath,
    routePath: buildProjectRoutePath(absolutePath),
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    isManuallyAdded: true,
    sessions: [],
    codexSessions: [],
    piSessions: []
  };
}
function normalizeComparablePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }
  const withoutLongPathPrefix = inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
  const normalized = path.normalize(withoutLongPathPrefix.trim());
  if (!normalized) {
    return '';
  }
  const resolved = path.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
async function findCodexJsonlFiles(dir) {
  const files = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findCodexJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
  }
  return files;
}
async function buildCodexProviderSessionsReadModel() {
  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  const sessionsByProject = new Map();
  const config = await loadProjectConfig();
  const codexSummaryById = getSessionSummaryOverrideMap(config);
  const workflowMetadataById = getSessionWorkflowMetadataMap(config);
  try {
    await fs.access(codexSessionsDir);
  } catch (error) {
    return sessionsByProject;
  }
  const jsonlFiles = await findCodexJsonlFiles(codexSessionsDir);
  for (const filePath of jsonlFiles) {
    try {
      const sessionData = await parseCodexSessionHeader(filePath) || await parseCodexSessionFile(filePath);
      if (!sessionData || !sessionData.id) {
        continue;
      }
      const normalizedProjectPath = normalizeComparablePath(sessionData.cwd);
      if (!normalizedProjectPath) {
        continue;
      }
      const session = applySessionWorkflowMetadata({
        ...buildCodexSessionFromHeader(sessionData, filePath),
        summary: codexSummaryById[sessionData.id] || sessionData.summary || 'Codex Session',
        title: codexSummaryById[sessionData.id] || sessionData.summary || 'Codex Session',
      }, workflowMetadataById, 'codex');
      void upsertProviderSessionIndex('codex', session);
      if (!sessionsByProject.has(normalizedProjectPath)) {
        sessionsByProject.set(normalizedProjectPath, []);
      }
      sessionsByProject.get(normalizedProjectPath).push(session);
    } catch (error) {
      console.warn(`Could not parse Codex session file ${filePath}:`, error.message);
    }
  }
  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }
  return sessionsByProject;
}
async function parseCodexSessionHeader(filePath) {
  const firstRecord = await readJsonlFirstRecord(filePath);
  if (firstRecord?.type !== 'session_meta' || !firstRecord.payload?.cwd) {
    return null;
  }
  const { thread, sessionFileName } = deriveCodexThreadFromJsonlPath(filePath);
  let stat = null;
  try {
    stat = await fs.stat(filePath);
  } catch {
    stat = null;
  }
  const timestamp = firstRecord.timestamp
    || firstRecord.payload.timestamp
    || stat?.mtime?.toISOString()
    || new Date().toISOString();
  return {
    id: thread,
    sourceSessionId: firstRecord.payload.id,
    thread,
    sessionFileName,
    cwd: firstRecord.payload.cwd,
    model: firstRecord.payload.model || firstRecord.payload.model_provider,
    createdAt: timestamp,
    timestamp: stat?.mtime?.toISOString() || timestamp,
    summary: 'Codex Session',
    title: 'Codex Session',
    messageCount: null,
    messageCountKnown: false,
    fileMtimeMs: typeof stat?.mtimeMs === 'number' ? stat.mtimeMs : null,
  };
}
async function buildCodexRouteTitleBySessionId(sessions, config = {}) {
  const routeTitleBySessionId = new Map();
  const titledSessionIds = new Set(
    Object.values(config?.chat || {})
      .filter((record) => {
        const title = typeof record?.title === 'string' ? record.title.trim() : '';
        return title && title !== 'Codex Session' && record?.titleSource !== AUTO_IMPORTED_ROUTE_TITLE_SOURCE;
      })
      .map((record) => record?.sessionId)
      .filter(Boolean),
  );
  const titleEntries = await Promise.all(sessions.map(async (session) => {
    if (!session?.id || session.summary !== 'Codex Session' || !session.filePath) {
      return null;
    }
    if (titledSessionIds.has(session.id)) {
      return null;
    }
    const firstUserMessage = await readCodexFirstUserMessageForHeader(session.filePath);
    if (!firstUserMessage) {
      return null;
    }
    return [
      session.id,
      truncateSessionTitleFromUserMessage(firstUserMessage),
    ];
  }));
  titleEntries
    .filter(Boolean)
    .forEach(([sessionId, title]) => routeTitleBySessionId.set(sessionId, title));
  return routeTitleBySessionId;
}
function truncateSessionTitleFromUserMessage(message, maxCharacters = 20) {
  const normalizedMessage = String(message || '').trim().replace(/\s+/g, ' ');
  return Array.from(normalizedMessage).slice(0, maxCharacters).join('');
}
async function readCodexFirstUserMessageForHeader(filePath, maxLines = 80) {
  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    let lineCount = 0;
    for await (const line of rl) {
      lineCount += 1;
      if (lineCount > maxLines) {
        rl.close();
        fileStream.destroy();
        break;
      }
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'event_msg' || entry.payload?.type !== 'user_message') {
          continue;
        }
        const message = typeof entry.payload.message === 'string' ? entry.payload.message.trim() : '';
        if (message && !isBootstrapSessionPrompt(message)) {
          rl.close();
          fileStream.destroy();
          return message;
        }
      } catch {
      }
    }
  } catch {
    return null;
  }
  return null;
}
async function getCachedCodexSessionsIndex() {
  const now = Date.now();
  const cacheKey = path.join(os.homedir(), '.codex', 'sessions');
  if (
    codexSessionsIndexCache
    && codexSessionsIndexCache.key === cacheKey
    && codexSessionsIndexCache.expiresAt > now
  ) {
    return codexSessionsIndexCache.value;
  }
  if (codexSessionsIndexPromise && codexSessionsIndexPromiseKey === cacheKey) {
    return codexSessionsIndexPromise;
  }
  codexSessionsIndexPromiseKey = cacheKey;
  codexSessionsIndexPromise = (async () => {
    const value = await buildCodexProviderSessionsReadModel();
    codexSessionsIndexCache = {
      key: cacheKey,
      value,
      expiresAt: Date.now() + CODEX_INDEX_CACHE_TTL_MS,
    };
    codexSessionsIndexPromise = null;
    codexSessionsIndexPromiseKey = '';
    return value;
  })().catch((error) => {
    codexSessionsIndexPromise = null;
    codexSessionsIndexPromiseKey = '';
    throw error;
  });
  return codexSessionsIndexPromise;
}
function getWarmCodexSessionsIndex() {
    const cacheKey = path.join(os.homedir(), '.codex', 'sessions');
  return codexSessionsIndexCache
    && codexSessionsIndexCache.key === cacheKey
    && codexSessionsIndexCache.expiresAt > Date.now()
    ? codexSessionsIndexCache.value
    : null;
}
function buildCodexSessionFromHeader(sessionData, filePath) {
    return {
    id: sessionData.id,
    summary: sessionData.summary || 'Codex Session',
    title: sessionData.summary || 'Codex Session',
    messageCount: typeof sessionData.messageCount === 'number' ? sessionData.messageCount : null,
    messageCountKnown: typeof sessionData.messageCount === 'number',
    createdAt: sessionData.createdAt ? new Date(sessionData.createdAt) : undefined,
    lastActivity: sessionData.timestamp ? new Date(sessionData.timestamp) : new Date(),
    cwd: sessionData.cwd,
    projectPath: sessionData.cwd,
    model: sessionData.model,
    thread: sessionData.thread,
    sessionFileName: sessionData.sessionFileName,
    sourceSessionId: sessionData.sourceSessionId,
    origin: sessionData.origin,
    filePath,
    fileMtimeMs: typeof sessionData.fileMtimeMs === 'number' ? sessionData.fileMtimeMs : null,
    provider: 'codex',
  };
}
async function collectRecentCodexSessionsForProject(projectPath, limit) {
    const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath || limit <= 0) {
    return [];
  }
  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  const jsonlFiles = await listRecentProviderJsonlFiles(codexSessionsDir, PROJECT_OVERVIEW_PROVIDER_FILE_LIMIT);
  const sessions = [];
  for (const filePath of jsonlFiles) {
    try {
      const sessionData = await parseCodexSessionHeader(filePath) || await parseCodexSessionFile(filePath);
      if (!sessionData?.id || normalizeComparablePath(sessionData.cwd) !== normalizedProjectPath) {
        continue;
      }
      const session = buildCodexSessionFromHeader(sessionData, filePath);
      sessions.push(session);
      await upsertProviderSessionIndex('codex', session);
      if (sessions.length >= limit) {
        break;
      }
    } catch (error) {
      console.warn(`Could not parse recent Codex session file ${filePath}:`, error.message);
    }
  }
  return sessions.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
}
async function getCodexSessions(projectPath, options = {}) {
  const {
    limit = 5,
    indexRef = null,
    includeHidden = false,
    excludeWorkflowChildSessions = false,
    preferRecentProjectScan = false,
    workflowOwnedSessionIds = null,
  } = options;
  try {
    const config = await loadProjectConfig(projectPath);
    const summaryOverrideById = getSessionSummaryOverrideMap(config);
    const workflowMetadataById = getSessionWorkflowMetadataMap(config);
    const originById = getSessionOriginByIdMap(config, 'codex');
    const modelStateById = getSessionModelStateMap(config);
    const normalizedProjectPath = normalizeComparablePath(projectPath);
    if (!normalizedProjectPath) {
      return [];
    }
    if (indexRef && !indexRef.sessionsByProject) {
      indexRef.sessionsByProject = await getCachedCodexSessionsIndex();
    }
    let indexedSessions = null;
    if (preferRecentProjectScan && limit > 0) {
      const indexedProviderSessions = await listIndexedProviderSessionsForProject('codex', projectPath, limit);
      const warmIndex = getWarmCodexSessionsIndex();
      const warmSessions = warmIndex ? warmIndex.get(normalizedProjectPath) || [] : [];
      const recentSessions = await collectRecentCodexSessionsForProject(projectPath, limit);
      indexedSessions = Array.from(
        new Map([...indexedProviderSessions, ...warmSessions, ...recentSessions].map((session) => [session?.id, session])).values(),
      )
        .filter((session) => session?.id)
        .sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0))
        .slice(0, limit);
      if (indexedSessions.length === 0) {
        const sessionsByProject = indexRef?.sessionsByProject || await getCachedCodexSessionsIndex();
        indexedSessions = sessionsByProject.get(normalizedProjectPath) || [];
      }
    } else {
      const sessionsByProject = indexRef?.sessionsByProject || await getCachedCodexSessionsIndex();
      indexedSessions = sessionsByProject.get(normalizedProjectPath) || [];
    }
    let sessions = indexedSessions
      .map((session) => applySessionMetadataOverrides(session, summaryOverrideById, workflowMetadataById, 'codex', originById))
      .map((session) => applySessionModelState(session, modelStateById));
    const resolvedWorkflowOwnedSessionIds = excludeWorkflowChildSessions
      ? (workflowOwnedSessionIds instanceof Set
        ? workflowOwnedSessionIds
        : getWorkflowOwnedProviderSessionIds(await listProjectWorkflows(projectPath), 'codex'))
      : null;
    if (excludeWorkflowChildSessions) {
      sessions = await applyWorkflowOwnedOriginFromState('codex', sessions, resolvedWorkflowOwnedSessionIds);
    }
    const providerSessionById = new Map(
      sessions.map((session) => [session?.id, session]).filter(([sessionId]) => Boolean(sessionId)),
    );
    let manualDraftRecords = getManualDraftSessionsForProject(config, {
      projectName: null,
      projectPath,
      provider: 'codex',
    }).map((draft) => {
      const providerSession = providerSessionById.get(draft?.providerSessionId);
      return providerSession?.origin === SESSION_ORIGIN_WORKFLOW
        ? { ...draft, origin: SESSION_ORIGIN_WORKFLOW }
        : draft;
    });
    const sessionsWithDrafts = buildProviderSessionListReadModel({
      provider: 'codex',
      providerSessions: sessions,
      manualDrafts: manualDraftRecords,
      workflowOwnedSessionIds: resolvedWorkflowOwnedSessionIds,
      excludeWorkflowChildSessions,
      includeHidden: true,
    });
    const annotatedSessions = await annotateSessionCollectionVisibility(sessionsWithDrafts, projectPath);
    const sessionsWithUiState = annotatedSessions.map((session) => applySessionUiState(
      session,
      projectPath,
      'codex',
      config,
    ));
    const visibleSessions = includeHidden
      ? sessionsWithUiState
      : filterHiddenArchivedSessions(sessionsWithUiState);
    const routeTitleBySessionId = await buildCodexRouteTitleBySessionId(visibleSessions, config);
    const indexedVisibleSessions = attachSessionRouteIndices(
      config,
      projectPath,
      'codex',
      visibleSessions,
      { routeTitleBySessionId },
    );
    if (indexedVisibleSessions.changed) {
      await saveProjectConfig(config, projectPath);
    }
    const hiddenCount = sessionsWithUiState.length - indexedVisibleSessions.sessions.length;
    if (hiddenCount > 0) {
      console.info(
        `[SessionVisibility] Codex path ${projectPath}: hidden ${hiddenCount} session(s) with missing project paths`,
      );
    }
    return limit > 0 ? indexedVisibleSessions.sessions.slice(0, limit) : [...indexedVisibleSessions.sessions];
  } catch (error) {
    console.error('Error fetching Codex sessions:', error);
    return [];
  }
}
async function listPiSessionFiles(rootDir = path.join(os.homedir(), '.pi', 'agent', 'sessions')) {
  const discoveredFiles = [];
  const walk = async (dir) => {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        discoveredFiles.push(fullPath);
      }
    }
  };
  await walk(rootDir);
  return discoveredFiles;
}
function isPiRenderableContentItem(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }
  if (item.type === 'text') {
    return Boolean(String(item.text || '').trim());
  }
  if (item.type === 'thinking') {
    return Boolean(String(item.thinking || '').trim());
  }
  if (item.type === 'toolCall') {
    return Boolean(item.name || item.id || item.arguments);
  }
  return false;
}
async function piTranscriptHasRenderableMessages(filePath) {
  const fileStream = fsSync.createReadStream(filePath, {
    encoding: 'utf8',
    highWaterMark: 16 * 1024,
  });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      try {
        const record = JSON.parse(line);
        if (record?.type !== 'message') {
          continue;
        }
        const content = record.message?.content;
        if (typeof content === 'string' && content.trim()) {
          return true;
        }
        if (Array.isArray(content) && content.some(isPiRenderableContentItem)) {
          return true;
        }
      } catch {
      }
    }
    return false;
  } finally {
    rl.close();
    fileStream.destroy();
  }
}
async function readPiFirstUserMessageForHeader(filePath, maxLines = 80) {
  const fileStream = fsSync.createReadStream(filePath, {
    encoding: 'utf8',
    highWaterMark: 16 * 1024,
  });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  try {
    let lineCount = 0;
    for await (const line of rl) {
      lineCount += 1;
      if (lineCount > maxLines) {
        break;
      }
      if (!line.trim()) {
        continue;
      }
      try {
        const record = JSON.parse(line);
        if (record?.type !== 'message' || record.message?.role !== 'user') {
          continue;
        }
        const message = extractPiTextContent(record.message?.content).trim();
        if (message && !isBootstrapSessionPrompt(message)) {
          return message;
        }
      } catch {
      }
    }
  } catch {
    return null;
  } finally {
    rl.close();
    fileStream.destroy();
  }
  return null;
}
async function readPiTranscriptTimeRange(filePath) {
  const fileStream = fsSync.createReadStream(filePath, {
    encoding: 'utf8',
    highWaterMark: 16 * 1024,
  });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  try {
    let firstTimestamp = null;
    let lastTimestamp = null;
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      try {
        const record = JSON.parse(line);
        const timestamp = typeof record?.timestamp === 'string' && record.timestamp.trim()
          ? record.timestamp.trim()
          : null;
        if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) {
          continue;
        }
        firstTimestamp = firstTimestamp || timestamp;
        lastTimestamp = timestamp;
      } catch {
      }
    }
    return { firstTimestamp, lastTimestamp };
  } catch {
    return { firstTimestamp: null, lastTimestamp: null };
  } finally {
    rl.close();
    fileStream.destroy();
  }
}
async function parsePiSessionHeader(filePath) {
  const firstRecord = await readJsonlFirstRecord(filePath);
  if (firstRecord?.type !== 'session' || !firstRecord.cwd) {
    return null;
  }
  if (!await piTranscriptHasRenderableMessages(filePath)) {
    return null;
  }
  let stat = null;
  try {
    stat = await fs.stat(filePath);
  } catch {
    stat = null;
  }
  const id = firstRecord.id || path.basename(filePath, '.jsonl');
  const transcriptTimes = await readPiTranscriptTimeRange(filePath);
  const createdAt = transcriptTimes.firstTimestamp
    || firstRecord.timestamp
    || stat?.birthtime?.toISOString()
    || stat?.mtime?.toISOString()
    || new Date().toISOString();
  const lastActivity = transcriptTimes.lastTimestamp
    || firstRecord.timestamp
    || stat?.mtime?.toISOString()
    || createdAt;
  const firstUserMessage = await readPiFirstUserMessageForHeader(filePath);
  const title = firstUserMessage
    ? truncateSessionTitleFromUserMessage(firstUserMessage)
    : (firstRecord.title || 'Pi Session');
  return {
    id,
    name: title,
    title,
    summary: title,
    createdAt,
    updated_at: lastActivity,
    lastActivity,
    messageCount: null,
    messageCountKnown: false,
    cwd: firstRecord.cwd,
    projectPath: firstRecord.cwd,
    provider: 'pi',
    __provider: 'pi',
    filePath,
  };
}
async function buildPiProviderSessionsReadModel() {
  const sessionsByProject = new Map();
  const piSessionsDir = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  const files = await listPiSessionFiles(piSessionsDir);
  for (const filePath of files) {
    try {
      const session = await parsePiSessionHeader(filePath);
      const normalizedProjectPath = normalizeComparablePath(session?.cwd);
      if (!normalizedProjectPath) {
        continue;
      }
      if (!sessionsByProject.has(normalizedProjectPath)) {
        sessionsByProject.set(normalizedProjectPath, []);
      }
      sessionsByProject.get(normalizedProjectPath).push(session);
      void upsertProviderSessionIndex('pi', session);
    } catch (error) {
      console.warn(`[Pi] Could not parse session header ${filePath}:`, error.message);
    }
  }
  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  }
  return sessionsByProject;
}
async function getCachedPiSessionsIndex() {
  const now = Date.now();
  const cacheKey = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  if (
    piSessionsIndexCache
    && piSessionsIndexCache.key === cacheKey
    && piSessionsIndexCache.expiresAt > now
  ) {
    return piSessionsIndexCache.value;
  }
  if (piSessionsIndexPromise && piSessionsIndexPromiseKey === cacheKey) {
    return piSessionsIndexPromise;
  }
  piSessionsIndexPromiseKey = cacheKey;
  piSessionsIndexPromise = (async () => {
    const value = await buildPiProviderSessionsReadModel();
    piSessionsIndexCache = {
      key: cacheKey,
      value,
      expiresAt: Date.now() + PI_INDEX_CACHE_TTL_MS,
    };
    piSessionsIndexPromise = null;
    piSessionsIndexPromiseKey = '';
    return value;
  })().catch((error) => {
    piSessionsIndexPromise = null;
    piSessionsIndexPromiseKey = '';
    throw error;
  });
  return piSessionsIndexPromise;
}
function getWarmPiSessionsIndex() {
    const cacheKey = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  return piSessionsIndexCache
    && piSessionsIndexCache.key === cacheKey
    && piSessionsIndexCache.expiresAt > Date.now()
    ? piSessionsIndexCache.value
    : null;
}
async function collectRecentPiSessionsForProject(projectPath, limit) {
    const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath || limit <= 0) {
    return [];
  }
  const piSessionsDir = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  const jsonlFiles = await listRecentProviderJsonlFiles(piSessionsDir, PROJECT_OVERVIEW_PROVIDER_FILE_LIMIT);
  const sessions = [];
  for (const filePath of jsonlFiles) {
    try {
      const session = await parsePiSessionHeader(filePath);
      if (!session?.id || normalizeComparablePath(session.cwd) !== normalizedProjectPath) {
        continue;
      }
      sessions.push(session);
      await upsertProviderSessionIndex('pi', session);
      if (sessions.length >= limit) {
        break;
      }
    } catch (error) {
      console.warn(`[Pi] Could not parse recent session header ${filePath}:`, error.message);
    }
  }
  return sessions.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
}
async function getPiSessions(projectPath, options = {}) {
  const {
    limit = PROJECT_OVERVIEW_SESSION_LIMIT,
    includeHidden = false,
    excludeWorkflowChildSessions = false,
    indexRef = null,
    preferRecentProjectScan = false,
    workflowOwnedSessionIds = null,
  } = options;
  const config = await loadProjectConfig(projectPath);
  const summaryOverrideById = getSessionSummaryOverrideMap(config);
  const workflowMetadataById = getSessionWorkflowMetadataMap(config);
  const originById = getSessionOriginByIdMap(config, 'pi');
  const modelStateById = getSessionModelStateMap(config);
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) {
    return [];
  }
  if (indexRef && !indexRef.sessionsByProject) {
    indexRef.sessionsByProject = await getCachedPiSessionsIndex();
  }
  let indexedSessions = null;
  if (preferRecentProjectScan && limit > 0) {
    indexedSessions = await listIndexedProviderSessionsForProject('pi', projectPath, limit);
    if (indexedSessions.length === 0) {
      const warmIndex = getWarmPiSessionsIndex();
      indexedSessions = warmIndex
        ? [...(warmIndex.get(normalizedProjectPath) || [])]
        : await collectRecentPiSessionsForProject(projectPath, limit);
    }
    if (indexedSessions.length === 0) {
      const sessionsByProject = indexRef?.sessionsByProject || await getCachedPiSessionsIndex();
      indexedSessions = [...(sessionsByProject.get(normalizedProjectPath) || [])];
    }
  } else {
    const sessionsByProject = indexRef?.sessionsByProject || await getCachedPiSessionsIndex();
    indexedSessions = [...(sessionsByProject.get(normalizedProjectPath) || [])];
  }
  const resolvedWorkflowOwnedSessionIds = excludeWorkflowChildSessions
    ? (workflowOwnedSessionIds instanceof Set
      ? workflowOwnedSessionIds
      : getWorkflowOwnedProviderSessionIds(await listProjectWorkflows(projectPath), 'pi'))
    : null;
  if (excludeWorkflowChildSessions) {
    indexedSessions = await applyWorkflowOwnedOriginFromState('pi', indexedSessions, resolvedWorkflowOwnedSessionIds);
  }
  const indexedSessionIds = new Set(indexedSessions.map((session) => session?.id).filter(Boolean));
  const shouldRecoverBoundPiSessions = !preferRecentProjectScan || indexedSessions.length < limit;
  if (shouldRecoverBoundPiSessions) {
    for (const record of Object.values(config?.chat || {})) {
      const providerSessionId = typeof record?.providerSessionId === 'string' ? record.providerSessionId.trim() : '';
      if (!providerSessionId || indexedSessionIds.has(providerSessionId)) {
        continue;
      }
      const sessionFilePath = await findPiSessionFilePath(providerSessionId);
      if (!sessionFilePath) {
        continue;
      }
      try {
        const providerSession = await parsePiSessionHeader(sessionFilePath);
        if (normalizeComparablePath(providerSession?.cwd) === normalizedProjectPath) {
          indexedSessions.push(providerSession);
          indexedSessionIds.add(providerSessionId);
        }
      } catch (error) {
        console.warn(`[Pi] Could not recover bound provider session ${providerSessionId}:`, error.message);
      }
    }
  }
  if (excludeWorkflowChildSessions) {
    indexedSessions = await applyWorkflowOwnedOriginFromState('pi', indexedSessions, resolvedWorkflowOwnedSessionIds);
  }
  let drafts = getManualDraftSessionsForProject(config, {
    projectName: null,
    projectPath,
    provider: 'pi',
  }).map((draft) => {
    const providerSessionId = typeof draft?.providerSessionId === 'string' ? draft.providerSessionId.trim() : '';
    const indexedProviderSession = providerSessionId
      ? indexedSessions.find((session) => session?.id === providerSessionId)
      : null;
    if (!indexedProviderSession) {
      return draft;
    }
    const updatedAt = indexedProviderSession.lastActivity
      || indexedProviderSession.updated_at
      || indexedProviderSession.updatedAt
      || draft.updated_at
      || draft.lastActivity
      || draft.createdAt;
    return {
      ...draft,
      createdAt: draft.createdAt || indexedProviderSession.createdAt || indexedProviderSession.created_at || updatedAt,
      updated_at: updatedAt,
      lastActivity: updatedAt,
      origin: indexedProviderSession.origin === SESSION_ORIGIN_WORKFLOW
        ? SESSION_ORIGIN_WORKFLOW
        : draft.origin,
    };
  });
  const draftSessionIds = new Set(drafts.map((session) => session?.id).filter(Boolean));
  const persistedCNPiEntries = Object.entries(config?.chat || {})
    .filter(([routeIndex, record]) => {
      if (!record || record.provider !== 'pi') return false;
      const sessionRouteIndex = parseManualSessionRouteIndex(record.sessionId);
      const recordSessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
      const routeId = sessionRouteIndex
        ? `c${sessionRouteIndex}`
        : (Number.isInteger(Number(routeIndex)) && Number(routeIndex) > 0 ? `c${Number(routeIndex)}` : null);
      if (!routeId) return false;
      const isProviderId = !sessionRouteIndex && recordSessionId;
      const isManualRouteRecord = record.origin === SESSION_ORIGIN_MANUAL
        || record.origin === SESSION_ORIGIN_WORKFLOW
        || Array.isArray(record.routePendingMessages);
      if (isProviderId && !indexedSessionIds.has(recordSessionId) && !isManualRouteRecord) {
        return false;
      }
      if (!isProviderId && !hasBoundPiManualDraft(record)) {
        return false;
      }
      return !draftSessionIds.has(routeId) && !draftSessionIds.has(record.sessionId);
    })
    .sort(([leftRouteIndex], [rightRouteIndex]) => Number(rightRouteIndex) - Number(leftRouteIndex));
  const persistedCNPiSessions = await Promise.all(
    (limit > 0 ? persistedCNPiEntries.slice(0, limit) : persistedCNPiEntries)
      .map(async ([routeIndex, record]) => {
      const sessionRouteIndex = parseManualSessionRouteIndex(record.sessionId);
      const routeId = sessionRouteIndex
        ? `c${sessionRouteIndex}`
        : `c${Number(routeIndex)}`;
      const isProviderId = !sessionRouteIndex && typeof record.sessionId === 'string' && record.sessionId.trim();
      const providerSessionId = isProviderId
        ? record.sessionId.trim()
        : (typeof record.providerSessionId === 'string' ? record.providerSessionId.trim() : '');
      const indexedProviderSession = providerSessionId
        ? indexedSessions.find((session) => session?.id === providerSessionId)
        : null;
      const createdAt = record.createdAt
        || indexedProviderSession?.createdAt
        || indexedProviderSession?.created_at
        || indexedProviderSession?.lastActivity
        || record.updatedAt
        || new Date().toISOString();
      const updatedAt = indexedProviderSession?.lastActivity
        || indexedProviderSession?.updated_at
        || indexedProviderSession?.updatedAt
        || record.updatedAt
        || createdAt;
      return buildManualDraftSession({
        id: routeId,
        provider: 'pi',
        label: record.title || `会话${routeIndex}`,
        projectName: '',
        projectPath: record.projectPath || projectPath,
        createdAt,
        updatedAt,
        providerSessionId: providerSessionId || undefined,
        workflowId: record.workflowId,
        stageKey: record.stageKey,
        origin: indexedProviderSession?.origin === SESSION_ORIGIN_WORKFLOW
          ? SESSION_ORIGIN_WORKFLOW
          : record.origin,
      });
    }),
  );
  drafts = [...drafts, ...persistedCNPiSessions];
  const providerSessionsWithMetadata = indexedSessions
    .map((session) => applySessionMetadataOverrides(session, summaryOverrideById, workflowMetadataById, 'pi', originById))
    .map((session) => applySessionModelState(session, modelStateById));
  const draftsWithMetadata = drafts
    .map((session) => applySessionMetadataOverrides(session, summaryOverrideById, workflowMetadataById, 'pi', originById))
    .map((session) => applySessionModelState(session, modelStateById));
  const sessionsWithDrafts = buildProviderSessionListReadModel({
    provider: 'pi',
    providerSessions: providerSessionsWithMetadata,
    manualDrafts: draftsWithMetadata.filter((session) => !excludeWorkflowChildSessions || !isWorkflowOwnedDraft({
      id: session.id,
      workflowId: session.workflowId,
      stageKey: session.stageKey,
      provider: 'pi',
    })),
    workflowOwnedSessionIds: resolvedWorkflowOwnedSessionIds,
    excludeWorkflowChildSessions,
    includeHidden: true,
  });
  const annotatedSessions = await annotateSessionCollectionVisibility(sessionsWithDrafts, projectPath);
  const sessionsWithUiState = annotatedSessions.map((session) => applySessionUiState(
    session,
    projectPath,
    'pi',
    config,
  ));
  const visibleSessions = includeHidden
    ? sessionsWithUiState
    : filterHiddenArchivedSessions(sessionsWithUiState);
  const indexedVisibleSessions = attachSessionRouteIndices(
    config,
    projectPath,
    'pi',
    visibleSessions,
  );
  if (indexedVisibleSessions.changed) {
    await saveProjectConfig(config, projectPath);
  }
  return limit > 0 ? indexedVisibleSessions.sessions.slice(0, limit) : [...indexedVisibleSessions.sessions];
}
async function attachManualSessionNextRouteIndex(project, projectPath) {
  const config = await loadProjectConfig(projectPath);
  const currentStandaloneCount = (
    (Array.isArray(project.sessions) ? project.sessions.length : 0)
    + (Array.isArray(project.codexSessions) ? project.codexSessions.length : 0)
    + (Array.isArray(project.piSessions) ? project.piSessions.length : 0)
  );
  project.manualSessionNextRouteIndex = getNextManualSessionRouteIndex(
    config,
    projectPath,
    currentStandaloneCount,
  );
}
async function populateProjectCollections(project, projectName, actualProjectDir, codexSessionsIndexRef, includeClaudeSessions = false) {
  const results = await Promise.allSettled([
    includeClaudeSessions
      ? getSessions(projectName, PROJECT_OVERVIEW_SESSION_LIMIT, 0, {
        includeHidden: true,
        excludeWorkflowChildSessions: true,
      })
      : Promise.resolve(null),
    getCodexSessions(actualProjectDir, {
      limit: PROJECT_OVERVIEW_SESSION_LIMIT,
      indexRef: codexSessionsIndexRef,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    }),
    getPiSessions(actualProjectDir, {
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    }),
  ]);
  const [claudeResult, codexResult, piResult] = results;
  if (includeClaudeSessions) {
    if (claudeResult.status === 'fulfilled' && claudeResult.value) {
      project.sessions = claudeResult.value.sessions || [];
      project.sessionMeta = {
        hasMore: claudeResult.value.hasMore,
        total: claudeResult.value.total,
      };
    } else {
      console.warn(`Could not load sessions for project ${projectName}:`, claudeResult.reason?.message || claudeResult.reason);
      project.sessionMeta = {
        hasMore: false,
        total: 0,
      };
    }
  }
  if (codexResult.status === 'fulfilled') {
    project.codexSessions = codexResult.value;
  } else {
    console.warn(`Could not load Codex sessions for project ${projectName}:`, codexResult.reason?.message || codexResult.reason);
    project.codexSessions = [];
  }
  if (piResult.status === 'fulfilled') {
    project.piSessions = piResult.value;
  } else {
    console.warn(`Could not load Pi sessions for project ${projectName}:`, piResult.reason?.message || piResult.reason);
    project.piSessions = [];
  }
  await attachManualSessionNextRouteIndex(project, actualProjectDir);
}
async function parseCodexSessionFile(filePath) {
  try {
    const { thread, sessionFileName } = deriveCodexThreadFromJsonlPath(filePath);
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    let sessionMeta = null;
    let firstTimestamp = null;
    let lastTimestamp = null;
    let firstUserMessage = null;
    let messageCount = 0;
    let inferredCwd = null;
    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          if (entry.timestamp) {
            firstTimestamp = firstTimestamp || entry.timestamp;
            lastTimestamp = entry.timestamp;
          }
          if (!inferredCwd && typeof entry.cwd === 'string' && entry.cwd.trim()) {
            inferredCwd = entry.cwd.trim();
          }
          if (entry.type === 'session_meta' && entry.payload) {
            sessionMeta = {
              id: entry.payload.id,
              cwd: entry.payload.cwd,
              model: entry.payload.model || entry.payload.model_provider,
              timestamp: entry.timestamp,
              git: entry.payload.git
            };
          }
          if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
            messageCount++;
            if (
              entry.payload.message
              && !firstUserMessage
              && !isBootstrapSessionPrompt(entry.payload.message)
            ) {
              firstUserMessage = entry.payload.message;
            }
          }
          if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'assistant') {
            messageCount++;
          }
        } catch (parseError) {
        }
      }
    }
    if (sessionMeta) {
      return {
        ...sessionMeta,
        id: thread,
        sourceSessionId: sessionMeta.id,
        thread,
        sessionFileName,
        createdAt: sessionMeta.timestamp || firstTimestamp || lastTimestamp,
        timestamp: lastTimestamp || sessionMeta.timestamp,
        summary: firstUserMessage ?
          (firstUserMessage.length > 50 ? firstUserMessage.substring(0, 50) + '...' : firstUserMessage) :
          'Codex Session',
        messageCount
      };
    }
    if (messageCount > 0) {
      const fixtureProjectPath = path.join(os.homedir(), 'workspace', 'fixture-project');
      const fallbackCwd = inferredCwd || (fsSync.existsSync(fixtureProjectPath) ? fixtureProjectPath : null);
      if (fallbackCwd) {
        return {
          id: thread,
          thread,
          sessionFileName,
          cwd: fallbackCwd,
          model: null,
          createdAt: firstTimestamp || lastTimestamp || new Date().toISOString(),
          timestamp: lastTimestamp || new Date().toISOString(),
          summary: firstUserMessage
            ? (firstUserMessage.length > 50 ? `${firstUserMessage.substring(0, 50)}...` : firstUserMessage)
            : 'Codex Session',
          messageCount,
        };
      }
    }
    return null;
  } catch (error) {
    console.error('Error parsing Codex session file:', error);
    return null;
  }
}
function extractCodexTextContent(content) {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }
  return content
    .map((item) => {
      if (item?.type === 'input_text' || item?.type === 'output_text' || item?.type === 'text') {
        return item.text || '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
function extractPiTextContent(content) {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }
  return content
    .map((item) => {
      if (item?.type === 'text') {
        return item.text || '';
      }
      if (item?.type === 'thinking') {
        return item.thinking || '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
function mapPiEntryToMessages(entry) {
  const messages = [];
  const sessionId = typeof entry.__sessionId === 'string' ? entry.__sessionId : 'unknown-session';
  const lineNumber = Number.isFinite(Number(entry.__lineNumber)) ? Number(entry.__lineNumber) : 0;
  const partMessageKey = (partIndex) => `pi:${sessionId}:line:${lineNumber}:part:${partIndex}`;
  const message = entry.message || {};
  const role = message.role || '';
  const content = Array.isArray(message.content)
    ? message.content
    : (typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : []);
  if (entry.type !== 'message') {
    return messages;
  }
  if (role === 'toolResult') {
    messages.push({
      type: 'tool_result',
      timestamp: entry.timestamp,
      provider: 'pi',
      messageKey: partMessageKey(0),
      toolCallId: message.toolCallId || entry.parentId || entry.id,
      toolName: message.toolName,
      output: extractPiTextContent(content),
    });
    return messages;
  }
  if (
    role === 'assistant' &&
    message.stopReason === 'stop' &&
    content.length === 1 &&
    content[0]?.type === 'thinking' &&
    String(content[0]?.thinking || '').trim()
  ) {
    messages.push({
      type: 'assistant',
      timestamp: entry.timestamp,
      provider: 'pi',
      messageKey: partMessageKey(0),
      message: {
        role: 'assistant',
        content: String(content[0].thinking || ''),
      },
    });
    return messages;
  }
  let pendingText = [];
  let pendingTextStartPart = null;
  const flushText = () => {
    const textContent = pendingText.filter(Boolean).join('\n');
    if (textContent.trim()) {
      messages.push({
        type: role === 'user' ? 'user' : 'assistant',
        timestamp: entry.timestamp,
        provider: 'pi',
        messageKey: partMessageKey(pendingTextStartPart ?? 0),
        message: {
          role: role === 'user' ? 'user' : 'assistant',
          content: textContent,
        },
      });
    }
    pendingText = [];
    pendingTextStartPart = null;
  };
  for (const [partIndex, item] of content.entries()) {
    if (item?.type === 'text') {
      if (pendingTextStartPart === null) {
        pendingTextStartPart = partIndex;
      }
      pendingText.push(item.text || '');
      continue;
    }
    flushText();
    const t = (item?.type === 'thinking' && item.thinking) ? item.thinking
      : (item?.type === 'reasoning_content' || item?.reasoning_content) ? (item.reasoning_content || item.text || '')
      : null;
    if (t) {
      messages.push({ type: 'thinking', timestamp: entry.timestamp, provider: 'pi', messageKey: partMessageKey(partIndex), message: { role: 'assistant', content: t } });
      continue;
    }
    if (item?.type === 'toolCall') {
      messages.push({ type: 'tool_use', timestamp: entry.timestamp, provider: 'pi', messageKey: partMessageKey(partIndex), toolName: item.name, toolInput: item.arguments, toolCallId: item.id || `${sessionId}:line:${lineNumber}:part:${partIndex}` });
    }
  }
  flushText();
  return messages;
}
async function findPiSessionFilePath(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return null;
  }
  const files = await listPiSessionFiles();
  const filenameMatch = files.find((filePath) => path.basename(filePath).includes(normalizedSessionId));
  if (filenameMatch) {
    return filenameMatch;
  }
  for (const filePath of files) {
    try {
      const firstRecord = await readJsonlFirstRecord(filePath);
      if (firstRecord?.id === normalizedSessionId) {
        return filePath;
      }
    } catch {
    }
  }
  return null;
}
async function readPiTranscriptByLineCursor(sessionFilePath, sessionId, limit = null, offset = 0, afterLine = null) {
  const lineResult = afterLine !== null && afterLine >= 0
    ? await readJsonlAfterLine(sessionFilePath, afterLine)
    : limit !== null
      ? await readJsonlTailWindow(sessionFilePath, limit, offset)
      : null;
  if (lineResult) {
    const messages = [];
    for (const entry of lineResult.lines) {
      try {
        const parsed = JSON.parse(entry.line);
        parsed.__sessionId = sessionId;
        parsed.__lineNumber = entry.lineNumber;
        messages.push(...mapPiEntryToMessages(parsed));
      } catch {
      }
    }
    return { messages, total: lineResult.total, tokenUsage: null };
  }
  const messages = [];
  const fileStream = fsSync.createReadStream(sessionFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      parsed.__sessionId = sessionId;
      parsed.__lineNumber = lineNumber;
      messages.push(...mapPiEntryToMessages(parsed));
    } catch {
    }
  }
  return { messages, total: lineNumber, tokenUsage: null };
}
async function getPiSessionMessages(sessionId, limit = null, offset = 0, afterLine = null) {
  try {
    const sessionFilePath = await findPiSessionFilePath(sessionId);
    if (!sessionFilePath) {
      console.warn(`Pi session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }
    const { messages, total, tokenUsage } = await readPiTranscriptByLineCursor(
      sessionFilePath,
      sessionId,
      limit,
      offset,
      afterLine,
    );
    return {
      messages,
      total,
      hasMore: limit !== null ? total > offset + limit : false,
      offset,
      limit,
      tokenUsage,
    };
  } catch (error) {
    console.error(`Error reading Pi session messages for ${sessionId}:`, error);
    return { messages: [], total: 0, hasMore: false };
  }
}
function extractCodexToolOutput(payload) {
  return normalizeCodexToolOutput(payload?.output ?? payload?.content ?? payload?.result);
}
function unwrapCodexUpdatePayload(payload) {
  let current = payload || {};
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object' || current.type !== 'update') {
      return current;
    }
    const nested = current.item || current.payload || current.data || current.update;
    if (!nested || typeof nested !== 'object' || nested === current) {
      return current;
    }
    current = nested;
  }
  return current;
}
function mapCodexNativeToolItem(entry, nextMessageKey) {
  const payload = entry.payload || {};
  const itemId = payload.id || payload.itemId || payload.call_id || payload.callId || nextMessageKey();
  const normalized = normalizeCodexRealtimeItem({
    ...payload,
    itemType: payload.type,
    itemId,
  });
  if (!normalized?.isToolUse) {
    return [];
  }
  const messages = [
    {
      type: 'tool_use',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      toolName: normalized.toolName,
      toolInput: normalized.toolInput,
      toolCallId: normalized.toolCallId || itemId,
    },
  ];
  if (normalized.toolResult) {
    messages.push({
      type: 'tool_result',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      toolCallId: normalized.toolCallId || itemId,
      output: normalized.toolResult.content ?? '',
    });
  }
  return messages;
}
function mapCodexEntryToMessages(entry) {
  const messages = [];
  const sessionId = typeof entry.__sessionId === 'string' ? entry.__sessionId : 'unknown-session';
  const lineNumber = Number.isFinite(Number(entry.__lineNumber)) ? Number(entry.__lineNumber) : 0;
  let subIndex = 0;
  const nextMessageFields = () => {
    const currentSubIndex = subIndex++;
    return {
      messageKey: buildCodexMessageKey(sessionId, lineNumber, currentSubIndex),
      sequence: (lineNumber * 1000) + currentSubIndex,
    };
  };
  const nextMessageKey = () => nextMessageFields().messageKey;
  const fallbackToolCallId = () => `codex-tool:${sessionId}:line:${lineNumber}`;
  const responsePayload = entry.type === 'response_item'
    ? unwrapCodexUpdatePayload(entry.payload || {})
    : null;
  if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
    const textContent = normalizeSearchableText(entry.payload.message);
    if (!textContent.trim()) {
      return messages;
    }
    messages.push({
      type: 'user',
      timestamp: entry.timestamp,
      ...nextMessageFields(),
      message: {
        role: 'user',
        content: textContent,
      },
    });
    return messages;
  }
  if (entry.type === 'response_item' && entry.payload?.type === 'message') {
    const content = entry.payload.content;
    const role = entry.payload.role || 'assistant';
    const textContent = extractCodexTextContent(content);
    if (!['user', 'assistant'].includes(role)) {
      return messages;
    }
    if (!textContent?.trim() || textContent.includes('<environment_context>')) {
      return messages;
    }
    const fileOperation = role === 'assistant'
      ? normalizeCodexFileOperationPayload(textContent)
      : null;
    if (fileOperation) {
      const toolCallId = fallbackToolCallId();
      messages.push({
        type: 'tool_use',
        timestamp: entry.timestamp,
        ...nextMessageFields(),
        toolName: 'FileChanges',
        toolInput: fileOperation,
        toolCallId,
      });
      messages.push({
        type: 'tool_result',
        timestamp: entry.timestamp,
        ...nextMessageFields(),
        toolCallId,
        output: '',
      });
      return messages;
    }
    messages.push({
      type: role === 'user' ? 'user' : 'assistant',
      timestamp: entry.timestamp,
      ...nextMessageFields(),
      message: {
        role,
        content: textContent,
        phase: typeof entry.payload.phase === 'string' ? entry.payload.phase : undefined,
      },
    });
    return messages;
  }
  if (entry.type === 'response_item' && entry.payload?.type === 'reasoning') {
    const summaryText = entry.payload.summary
      ?.map((summary) => summary.text)
      .filter(Boolean)
      .join('\n');
    if (summaryText?.trim()) {
      messages.push({
        type: 'thinking',
        timestamp: entry.timestamp,
        ...nextMessageFields(),
        message: {
          role: 'assistant',
          content: summaryText,
        },
      });
    }
    return messages;
  }
  if (
    entry.type === 'response_item' &&
    ['command_execution', 'file_change', 'mcp_tool_call'].includes(entry.payload?.type)
  ) {
    return mapCodexNativeToolItem(entry, nextMessageKey);
  }
  if (entry.type === 'response_item' && ['function_call', 'functionCall'].includes(responsePayload?.type)) {
    const normalizedTool = normalizeCodexFunctionCall(responsePayload);
    const toolCallId = normalizedTool.toolCallId || fallbackToolCallId();
    messages.push({
      type: 'tool_use',
      timestamp: entry.timestamp,
      ...nextMessageFields(),
      toolName: normalizedTool.toolName,
      toolInput: normalizedTool.toolInput,
      toolCallId,
    });
    return messages;
  }
  if (entry.type === 'response_item' && ['function_call_output', 'functionCallOutput'].includes(responsePayload?.type)) {
    messages.push({
      type: 'tool_result',
      timestamp: entry.timestamp,
      ...nextMessageFields(),
      toolCallId: responsePayload.call_id || responsePayload.callId || responsePayload.id || fallbackToolCallId(),
      output: extractCodexToolOutput(responsePayload),
      subagentTools: Array.isArray(responsePayload.subagentTools) ? responsePayload.subagentTools : undefined,
    });
    return messages;
  }
  if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call') {
    const toolName = entry.payload.name || 'custom_tool';
    const input = entry.payload.input || '';
    if (toolName === 'apply_patch') {
      const fileMatch = input.match(/\*\*\* Update File: (.+)/);
      const filePath = fileMatch ? fileMatch[1].trim() : 'unknown';
      const lines = input.split('\n');
      const oldLines = [];
      const newLines = [];
      for (const line of lines) {
        if (line.startsWith('-') && !line.startsWith('---')) {
          oldLines.push(line.substring(1));
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          newLines.push(line.substring(1));
        }
      }
      messages.push({
        type: 'tool_use',
        timestamp: entry.timestamp,
        ...nextMessageFields(),
        toolName: 'Edit',
        toolInput: JSON.stringify({
          file_path: filePath,
          old_string: oldLines.join('\n'),
          new_string: newLines.join('\n'),
        }),
        toolCallId: entry.payload.call_id || fallbackToolCallId(),
      });
      return messages;
    }
    messages.push({
      type: 'tool_use',
      timestamp: entry.timestamp,
      ...nextMessageFields(),
      toolName,
      toolInput: input,
      toolCallId: entry.payload.call_id || fallbackToolCallId(),
    });
    return messages;
  }
  if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call_output') {
    messages.push({
      type: 'tool_result',
      timestamp: entry.timestamp,
      ...nextMessageFields(),
      toolCallId: entry.payload.call_id || fallbackToolCallId(),
      output: extractCodexToolOutput(entry.payload),
    });
  }
  return messages;
}
function dedupeCodexUserEchoMessages(messages) {
  const seenUserTurns = new Set();
  const recentUserTurnTimestamps = new Map();
  return messages.filter((message) => {
    if (message?.type !== 'user') {
      return true;
    }
    const textContent = normalizeSearchableText(message.message?.content || message.content || '');
    if (!textContent.trim()) {
      return true;
    }
    const timestamp = new Date(message.timestamp || 0).getTime();
    const timeKey = Number.isFinite(timestamp) ? String(timestamp) : String(message.timestamp || '');
    const key = `${timeKey}:${textContent}`;
    if (seenUserTurns.has(key)) {
      return false;
    }
    const recentTimestamp = recentUserTurnTimestamps.get(textContent);
    if (
      Number.isFinite(timestamp)
      && Number.isFinite(recentTimestamp)
      && Math.abs(timestamp - recentTimestamp) <= 1000
    ) {
      return false;
    }
    seenUserTurns.add(key);
    if (Number.isFinite(timestamp)) {
      recentUserTurnTimestamps.set(textContent, timestamp);
    }
    return true;
  });
}
function mapCodexTranscriptLineEntries(entries, sessionId) {
  const messages = [];
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.line);
      parsed.__sessionId = sessionId;
      parsed.__lineNumber = entry.lineNumber;
      messages.push(...mapCodexEntryToMessages(parsed));
    } catch {
    }
  }
  return dedupeCodexUserEchoMessages(messages);
}
async function readCodexTranscriptByLineCursor(sessionFilePath, sessionId, limit = null, offset = 0, afterLine = null) {
  if (afterLine !== null && afterLine >= 0) {
    const result = await readJsonlAfterLine(sessionFilePath, afterLine);
    return {
      messages: mapCodexTranscriptLineEntries(result.lines, sessionId),
      total: result.total,
      tokenUsage: null,
      nextRawLineOffset: null,
    };
  }
  if (limit !== null) {
    const result = await readJsonlTailWindow(sessionFilePath, limit, offset);
    return {
      messages: mapCodexTranscriptLineEntries(result.lines, sessionId),
      total: result.total,
      tokenUsage: null,
      nextRawLineOffset: Math.min(result.total, offset + limit),
    };
  }
  const messages = [];
  const fileStream = fsSync.createReadStream(sessionFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  let lineNumber = 0;
  let tokenUsage = null;
  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      entry.__sessionId = sessionId;
      entry.__lineNumber = lineNumber;
      if (!tokenUsage && entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
        tokenUsage = await getCodexSessionTokenUsageFromFile(sessionFilePath);
      }
      messages.push(...mapCodexEntryToMessages(entry));
    } catch { /* Skip malformed lines while still advancing the raw line cursor. */ }
  }
  return { messages: dedupeCodexUserEchoMessages(messages), total: lineNumber, tokenUsage, nextRawLineOffset: null };
}
async function getCodexSessionMessages(sessionId, limit = null, offset = 0, afterLine = null) {
  try {
    const sessionFilePath = await findCodexSessionFilePath(sessionId);
    if (!sessionFilePath) {
      console.warn(`Codex session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }
    if (afterLine !== null && afterLine >= 0) {
      const { messages, total, tokenUsage, nextRawLineOffset } = await readCodexTranscriptByLineCursor(
        sessionFilePath,
        sessionId,
        null,
        0,
        afterLine,
      );
      return {
        messages,
        total,
        hasMore: false,
        offset: 0,
        limit: null,
        tokenUsage,
        nextRawLineOffset,
      };
    }
    if (limit !== null) {
      const { messages: paginatedMessages, total, tokenUsage, nextRawLineOffset } = await readCodexTranscriptByLineCursor(
        sessionFilePath,
        sessionId,
        limit,
        offset,
        null,
      );
      return {
        messages: paginatedMessages,
        total,
        hasMore: total > offset + limit,
        offset,
        limit,
        tokenUsage,
        nextRawLineOffset,
      };
    }
    const { messages, total, tokenUsage, nextRawLineOffset } = await readCodexTranscriptByLineCursor(
      sessionFilePath,
      sessionId,
      null,
      0,
      null,
    );
    return { messages, total, tokenUsage, nextRawLineOffset };
  } catch (error) {
    console.error(`Error reading Codex session messages for ${sessionId}:`, error);
    return { messages: [], total: 0, hasMore: false };
  }
}
function extractCodexSearchableMessages(rawMessages) {
  const searchableMessages = [];
  const toolMessageKeyById = new Map();
  for (const rawMessage of rawMessages) {
    const timestamp = rawMessage.timestamp;
    if (rawMessage.type === 'tool_use') {
      const messageKey = rawMessage.messageKey;
      if (rawMessage.toolCallId && messageKey) {
        toolMessageKeyById.set(rawMessage.toolCallId, messageKey);
      }
      const text = [rawMessage.toolName, normalizeSearchableText(rawMessage.toolInput)]
        .filter(Boolean)
        .join('\n')
        .trim();
      if (messageKey && text) {
        searchableMessages.push({ messageKey, text, timestamp });
      }
      continue;
    }
    if (rawMessage.type === 'tool_result') {
      const text = normalizeSearchableText(rawMessage.output);
      const messageKey = toolMessageKeyById.get(rawMessage.toolCallId) || rawMessage.messageKey;
      if (messageKey && text.trim()) {
        searchableMessages.push({ messageKey, text, timestamp });
      }
      continue;
    }
    const text = normalizeSearchableText(rawMessage.message?.content);
    if (rawMessage.messageKey && text.trim()) {
      searchableMessages.push({
        messageKey: rawMessage.messageKey,
        text,
        timestamp,
      });
    }
  }
  return searchableMessages;
}
function findWorkflowSessionRoute(project, sessionId) {
  const workflows = Array.isArray(project?.workflows) ? project.workflows : [];
  for (const workflow of workflows) {
    const workflowRouteIndex = Number.isInteger(Number(workflow.routeIndex))
      ? Number(workflow.routeIndex)
      : Number.parseInt(String(workflow.id || '').replace(/^w/, ''), 10);
    const childSession = Array.isArray(workflow.childSessions)
      ? workflow.childSessions.find((session) => session?.id === sessionId)
      : null;
    if (childSession) {
      return {
        workflowId: workflow.id,
        workflowRouteIndex,
        routeIndex: childSession.routeIndex,
        workflowStageKey: childSession.stageKey || childSession.role || childSession.id,
      };
    }
    const runnerProcess = Array.isArray(workflow.runnerProcesses)
      ? workflow.runnerProcesses.find((process) => process?.sessionId === sessionId)
      : null;
    if (runnerProcess) {
      const routeIndex = Array.isArray(workflow.childSessions)
        ? workflow.childSessions.find((session) => session?.id === sessionId)?.routeIndex
        : undefined;
      return {
        workflowId: workflow.id,
        workflowRouteIndex,
        routeIndex,
        workflowStageKey: runnerProcess.stage || runnerProcess.role,
      };
    }
  }
  return null;
}
async function searchChatHistory(query, mode = 'content') {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    return [];
  }
  const searchMode = mode === 'jsonl' ? 'jsonl' : 'content';
  clearProjectDirectoryCache();
  clearSessionPathExistenceCache();
  const projects = await Promise.all((await getProjects()).map(async (project) => ({
    ...project,
    workflows: await listProjectWorkflows(project.fullPath || project.path || ''),
  })));
  const results = [];
  const projectByPath = new Map(
    projects
      .map((project) => [normalizeComparablePath(project.fullPath || project.path), project])
      .filter(([normalizedPath]) => Boolean(normalizedPath)),
  );
  const seenCodexSessionIds = new Set();
  for (const project of projects) {
    const codexSessions = Array.isArray(project.codexSessions) ? project.codexSessions : [];
    for (const session of codexSessions) {
      seenCodexSessionIds.add(session.id);
      if (searchMode === 'jsonl') {
        const identityText = [
          session.thread,
          session.sessionFileName,
          path.basename(session.sessionFileName || '', '.jsonl'),
        ].filter(Boolean).join('\n');
        if (!matchesSearchQuery(identityText, trimmedQuery)) {
          continue;
        }
        results.push({
          resultType: 'session',
          projectName: project.name,
          projectDisplayName: project.displayName,
          provider: 'codex',
          sessionId: session.id,
          routeIndex: session.routeIndex,
          ...findWorkflowSessionRoute(project, session.id),
          sessionSummary: session.summary || session.title || 'Codex Session',
          thread: session.thread || session.id,
          sessionFileName: session.sessionFileName,
          snippet: session.sessionFileName || session.thread || session.id,
          timestamp: session.updated_at || session.lastActivity || session.createdAt || null,
        });
        continue;
      }
      const sessionPayload = await getCodexSessionMessages(session.id, null, 0, null);
      const rawMessages = Array.isArray(sessionPayload?.messages) ? sessionPayload.messages : [];
      const searchableMessages = extractCodexSearchableMessages(rawMessages);
      for (const message of searchableMessages) {
        if (!matchesSearchQuery(message.text, trimmedQuery)) {
          continue;
        }
        results.push({
          resultType: 'message',
          projectName: project.name,
          projectDisplayName: project.displayName,
          provider: 'codex',
          sessionId: session.id,
          routeIndex: session.routeIndex,
          sessionSummary: session.summary || session.title || 'Codex Session',
          messageKey: message.messageKey,
          snippet: buildSearchSnippet(message.text, trimmedQuery),
          timestamp: message.timestamp || session.updated_at || session.lastActivity || session.createdAt || null,
        });
      }
    }
  }
  const codexSessionFiles = await listCodexSessionFiles();
  for (const sessionFilePath of codexSessionFiles) {
    const { thread, sessionFileName } = deriveCodexThreadFromJsonlPath(sessionFilePath);
    let sessionMeta = null;
    try {
      const fileStream = fsSync.createReadStream(sessionFilePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }
        const entry = JSON.parse(line);
        if (entry.type === 'session_meta' && entry.payload?.id) {
          sessionMeta = {
            id: thread,
            sourceSessionId: entry.payload.id,
            cwd: entry.payload.cwd || '',
          };
          break;
        }
      }
    } catch {
      continue;
    }
    if (!sessionMeta?.id || seenCodexSessionIds.has(sessionMeta.id)) {
      continue;
    }
    const project = projectByPath.get(normalizeComparablePath(sessionMeta.cwd || '')) || null;
    if (searchMode === 'jsonl') {
      const identityText = [thread, sessionFileName, path.basename(sessionFileName, '.jsonl')]
        .filter(Boolean)
        .join('\n');
      if (!matchesSearchQuery(identityText, trimmedQuery)) {
        continue;
      }
      results.push({
        resultType: 'session',
        projectName: project?.name || encodeProjectPathAsName(sessionMeta.cwd || ''),
        projectDisplayName: project?.displayName || path.basename(sessionMeta.cwd || '') || 'Codex Session',
        provider: 'codex',
        sessionId: thread,
        ...(project ? findWorkflowSessionRoute(project, thread) : null),
        sessionSummary: 'Codex Session',
        thread,
        sessionFileName,
        snippet: sessionFileName,
        timestamp: null,
      });
      continue;
    }
    const sessionPayload = await getCodexSessionMessages(sessionMeta.id, null, 0, null);
    const rawMessages = Array.isArray(sessionPayload?.messages) ? sessionPayload.messages : [];
    const searchableMessages = extractCodexSearchableMessages(rawMessages);
    for (const message of searchableMessages) {
      if (!matchesSearchQuery(message.text, trimmedQuery)) {
        continue;
      }
      results.push({
        resultType: 'message',
        projectName: project?.name || encodeProjectPathAsName(sessionMeta.cwd || ''),
        projectDisplayName: project?.displayName || path.basename(sessionMeta.cwd || '') || 'Codex Session',
        provider: 'codex',
        sessionId: thread,
        sessionSummary: 'Codex Session',
        messageKey: message.messageKey,
        snippet: buildSearchSnippet(message.text, trimmedQuery),
        timestamp: message.timestamp || null,
      });
    }
  }
  const piSessionsByProject = await getCachedPiSessionsIndex();
  for (const [normalizedProjectPath, piSessions] of piSessionsByProject.entries()) {
    const project = projectByPath.get(normalizedProjectPath) || null;
    for (const session of piSessions || []) {
      if (searchMode === 'jsonl') {
        const identityText = [
          session.id,
          session.filePath ? path.basename(session.filePath) : '',
        ].filter(Boolean).join('\n');
        if (!matchesSearchQuery(identityText, trimmedQuery)) {
          continue;
        }
        results.push({
          resultType: 'session',
          projectName: project?.name || encodeProjectPathAsName(session.projectPath || ''),
          projectDisplayName: project?.displayName || path.basename(session.projectPath || '') || 'Pi Session',
          provider: 'pi',
          sessionId: session.id,
          ...(project ? findWorkflowSessionRoute(project, session.id) : null),
          sessionSummary: session.summary || session.title || 'Pi Session',
          snippet: session.filePath ? path.basename(session.filePath) : session.id,
          timestamp: session.updated_at || session.lastActivity || session.createdAt || null,
        });
        continue;
      }
      const sessionPayload = await getPiSessionMessages(session.id, null, 0, null);
      const rawMessages = Array.isArray(sessionPayload?.messages) ? sessionPayload.messages : [];
      const searchableMessages = extractCodexSearchableMessages(rawMessages);
      for (const message of searchableMessages) {
        if (!matchesSearchQuery(message.text, trimmedQuery)) {
          continue;
        }
        results.push({
          resultType: 'message',
          projectName: project?.name || encodeProjectPathAsName(session.projectPath || ''),
          projectDisplayName: project?.displayName || path.basename(session.projectPath || '') || 'Pi Session',
          provider: 'pi',
          sessionId: session.id,
          sessionSummary: session.summary || session.title || 'Pi Session',
          messageKey: message.messageKey,
          snippet: buildSearchSnippet(message.text, trimmedQuery),
          timestamp: message.timestamp || session.updated_at || session.lastActivity || session.createdAt || null,
        });
      }
    }
  }
  results.sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0));
  return results;
}
async function readCodexSessionProjectPath(sessionFilePath) {
  const fileStream = fsSync.createReadStream(sessionFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      const cwd = typeof entry?.payload?.cwd === 'string'
        ? entry.payload.cwd
        : (typeof entry?.cwd === 'string' ? entry.cwd : '');
      if (cwd.trim()) {
        return cwd.trim();
      }
    } catch {
    }
  }
  return '';
}
async function deleteCodexSession(sessionId, projectPath = '') {
  try {
    if (await deleteManualSessionDraft(sessionId, 'codex', projectPath)) {
      return true;
    }
    const sessionFilePath = await findCodexSessionFilePath(sessionId);
    if (sessionFilePath) {
      const resolvedProjectPath = projectPath || await readCodexSessionProjectPath(sessionFilePath);
      await fs.unlink(sessionFilePath);
      await deleteProviderSessionIndexFile('codex', sessionFilePath);
      await cleanupDeletedSessionConfig(sessionId, resolvedProjectPath, 'codex');
      codexSessionFileCache.delete(sessionId);
      clearProjectDirectoryCache();
      return true;
    }
    const config = await loadProjectConfig(projectPath);
    const chatRecord = findProjectChatRecord(config, sessionId);
    if (chatRecord?.record && (!chatRecord.record.provider || chatRecord.record.provider === 'codex')) {
      await cleanupDeletedSessionConfig(sessionId, projectPath, 'codex');
      clearProjectDirectoryCache();
      return true;
    }
    throw new Error(`Codex session file not found for session ${sessionId}`);
  } catch (error) {
    console.error(`Error deleting Codex session ${sessionId}:`, error);
    throw error;
  }
}
async function refreshMissingProjectPathCache(options = {}) {
  const logger = options.logger || console;
  const startedAt = Date.now();
  const stats = {
    checkedPaths: 0,
    missingPaths: 0,
    scannedSessions: 0,
    durationMs: 0
  };
  clearSessionPathExistenceCache();
  const projects = await getProjects();
  logger.info(`[SessionVisibility] Startup scan begin: ${projects.length} project(s)`);
  for (const project of projects) {
    const projectPath = project.fullPath || project.path || '';
    if (projectPath) {
      stats.checkedPaths += 1;
      await projectPathExists(projectPath, { forceRefresh: true });
    }
    let offset = 0;
    const pageSize = 200;
    while (true) {
      const result = await getSessions(project.name, pageSize, offset, { includeHidden: true });
      const sessions = result?.sessions || [];
      stats.scannedSessions += sessions.length;
      for (const session of sessions) {
        const sessionProjectPath = resolveSessionProjectPath(session, projectPath);
        if (!sessionProjectPath) {
          continue;
        }
        stats.checkedPaths += 1;
        await projectPathExists(sessionProjectPath, { forceRefresh: true });
      }
      if (!result?.hasMore) {
        break;
      }
      offset += pageSize;
    }
    const codexSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    stats.scannedSessions += codexSessions.length;
    for (const session of codexSessions) {
      const sessionProjectPath = resolveSessionProjectPath(session, projectPath);
      if (!sessionProjectPath) {
        continue;
      }
      stats.checkedPaths += 1;
      await projectPathExists(sessionProjectPath, { forceRefresh: true });
    }
  }
  stats.missingPaths = Array.from(sessionPathExistenceCache.values()).filter((entry) => entry.exists === false).length;
  stats.durationMs = Date.now() - startedAt;
  logger.info(
    `[SessionVisibility] Startup scan complete: checked=${stats.checkedPaths}, missing=${stats.missingPaths}, sessions=${stats.scannedSessions}, duration=${stats.durationMs}ms`,
  );
  return stats;
}
configureProviderSessionReadModel({
  getDb: async () => (await import('./database/db.js')).db,
  getProviderSessionIndexDb: async () => (await import('./provider-session-index-store.js')).providerSessionIndexDb,
  parseCodexSessionHeader,
  parseCodexSessionFile,
  buildCodexSessionFromHeader,
  parsePiSessionHeader,
  warn: (message, error) => console.warn(message, error?.message || error),
});
const buildCodexSessionsIndex = buildCodexProviderSessionsReadModel;
const buildPiSessionsIndex = buildPiProviderSessionsReadModel;
export { getProjects, getSessions, getSessionMessages, parseJsonlSessions, renameProject, updateSessionUiState, renameSession, renameCodexSession, createManualSessionDraft, initManualSessionRoute, bindManualSessionProvider, getManualSessionRouteRuntime, finalizeManualSessionRoute, deleteSession, isProjectEmpty, deleteProject, addProjectManually, loadProjectConfig, saveProjectConfig, findProjectChatRecord, getSessionModelState, updateSessionModelState, createDefaultProjectArchiveIndex, getProjectArchiveFilePath, loadProjectArchiveIndex, saveProjectArchiveIndex, isMissingProjectPathError, validateProjectPathAvailability, evaluateProjectArchival, extractProjectDirectory, buildProjectRoutePath, clearProjectDirectoryCache, refreshMissingProjectPathCache, getCodexSessions, getPiSessions, readJsonlFirstRecord, parseCodexSessionHeader, buildCodexSessionsIndex, parsePiSessionHeader, buildPiSessionsIndex, getCachedPiSessionsIndex, indexProviderSessionFile, deleteProviderSessionIndexFile, getCodexSessionMessages, getPiSessionMessages, searchChatHistory, deleteCodexSession, };
