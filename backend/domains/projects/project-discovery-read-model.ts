/**
 * PURPOSE: Typed read model for project discovery from manual config and
 * provider session history without relying on runtime fallback modules.
 */
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import {
  buildProjectRoutePath,
  DISPLAY_NAME_BY_PATH_KEY,
  evaluateProjectArchival,
  isPlainRecord,
  loadProjectArchiveIndex,
  loadProjectConfig,
  normalizeProjectPath,
  saveProjectArchiveIndex,
  saveProjectConfig,
  type LooseRecord,
} from './project-config-read-model.js';
import { summarizeProjectForList } from './project-overview-read-model.js';
import {
  getCodexSessions,
  getPiSessions,
  getClaudeSessions,
} from './project-overview-service.js';
import {
  buildCodexSessionsIndex,
  buildPiSessionsIndex,
  buildClaudeSessionsIndex,
  clearProviderSessionIndexCaches,
} from './provider-session-index-read-model.js';
import {
  listCodexSessionFiles,
  listPiSessionFiles,
  listClaudeSessionFiles,
  parseCodexSessionHeader,
  parsePiSessionHeader,
  parseClaudeSessionHeader,
} from './provider-transcript-read-model.js';
import { db } from '../../database/db.js';
import { projectIndexDb } from '../../project-index-store.js';
import { reconcileProjectIndex } from './project-index-sync-service.js';

let projectDirectoryCache = new Map<string, string>();
const PROVIDER_ONLY_PROJECT_LIMIT = 50;
const LIGHTWEIGHT_PROVIDER_PROJECT_FILE_LIMIT = PROVIDER_ONLY_PROJECT_LIMIT * 4;
const PROVIDER_INDEX_HOME_BUDGET_MS = (() => {
  const parsed = Number.parseInt(process.env.PROVIDER_INDEX_HOME_BUDGET_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2500;
})();

/**
 * Test hooks for project discovery filtering behavior.
 */
export const __projectDiscoveryForTest = {
  filterAndDisambiguateProjects(projects: LooseRecord[]): LooseRecord[] {
    return filterAndDisambiguateProjects(projects);
  },
  isGoTestTempProjectPath(projectPath = ''): boolean {
    return /[/\\]Test[^/\\]+[/\\]\d+/.test(projectPath);
  },
};

/**
 * Return the normalized directory path used for project identity.
 */
export async function extractProjectDirectory(projectName = ''): Promise<string> {
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName) as string;
  }
  const config = await loadProjectConfig();
  const configuredPath = isPlainRecord(config[projectName]) && typeof config[projectName].originalPath === 'string'
    ? config[projectName].originalPath
    : projectName.replace(/-/g, '/');
  projectDirectoryCache.set(projectName, configuredPath);
  return configuredPath;
}

/**
 * Clear cached project discovery and provider index state.
 */
export function clearProjectDirectoryCache(): void {
  projectDirectoryCache = new Map();
  clearProviderSessionIndexCaches();
}

/**
 * Re-scan missing project paths so session visibility reflects disk state.
 */
export async function refreshMissingProjectPathCache(options: LooseRecord = {}): Promise<LooseRecord> {
  /**
   * PURPOSE: Reconcile the SQLite project read model during startup/periodic
   * maintenance instead of leaving stale manual/provider rows visible forever.
   */
  clearProjectDirectoryCache();
  const result = await reconcileProjectIndex();
  if (result.hiddenCount > 0 && options?.logger?.info) {
    options.logger.info(`[SessionVisibility] Hidden ${result.hiddenCount} stale project index rows`);
  }
  return { refreshed: true, ...result };
}

/**
 * Build the project list read model used by the home project sidebar.
 */
export async function getProjects(_progress: unknown = null, options: LooseRecord = {}): Promise<LooseRecord[]> {
  const lightweightList = options?.lightweightList === true;
  const projects: LooseRecord[] = lightweightList
    ? projectIndexDb.listVisible(db).map((project) => ({
      ...project,
      path: project.fullPath || project.path,
      fullPath: project.fullPath || project.path,
      source: project.source || 'db',
    }))
    : [];
  if (lightweightList) {
    return filterAndDisambiguateProjects(projects.map(summarizeProjectForList));
  }
  const config = await loadProjectConfig();
  const archiveIndex = await loadProjectArchiveIndex();
  const usedNames = new Set<string>();
  const knownPaths = new Set(projects.map((project) => normalizeProjectPath(project.fullPath || project.path || '')));
  for (const project of projects) {
    usedNames.add(String(project.name || ''));
  }
  const hydratedIndexes = lightweightList
    ? null
    : await resolveProviderIndexesWithinHomeBudget();

  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!isPlainRecord(projectConfig) || projectConfig.manuallyAdded !== true) {
      continue;
    }
    const projectPath = typeof projectConfig.originalPath === 'string'
      ? projectConfig.originalPath
      : projectName.replace(/-/g, '/');
    const project = buildProjectSummary(projectName, projectPath, config, true);
    if (!lightweightList) {
      project.codexSessions = await getCodexSessions(projectPath, {
        includeHidden: true,
        providerSessionIndex: hydratedIndexes?.codex,
        skipProviderScan: true,
      });
      project.piSessions = await readProviderSessionsWithinHomeBudget(() => getPiSessions(projectPath, {
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        providerSessionIndex: hydratedIndexes?.pi,
        skipProviderScan: true,
      }));
    }
    const archival = await evaluateProjectArchival({
      projectPath,
      path: projectPath,
      source: 'manual',
      archiveIndex,
    });
    if (archival.archiveUpdated) {
      await saveProjectArchiveIndex(archiveIndex);
    }
    if (!archival.excludeFromList) {
      projects.push(project);
    }
    usedNames.add(project.name);
    knownPaths.add(normalizeProjectPath(projectPath));
  }

  await appendProviderOnlyProjects(projects, usedNames, knownPaths, config, lightweightList, hydratedIndexes);

  return filterAndDisambiguateProjects(lightweightList ? projects.map(summarizeProjectForList) : projects);
}

/**
 * Add a project path to local project configuration.
 */
export async function addProjectManually(projectPath = '', displayName: string | null = null): Promise<LooseRecord> {
  const normalizedPath = normalizeProjectPath(projectPath);
  const config = await loadProjectConfig();
  const projectName = createProjectName(normalizedPath, config);
  const displayNameByPath = isPlainRecord(config[DISPLAY_NAME_BY_PATH_KEY])
    ? { ...config[DISPLAY_NAME_BY_PATH_KEY] }
    : {};
  if (displayName && displayName.trim()) {
    displayNameByPath[normalizedPath] = displayName.trim();
    config[DISPLAY_NAME_BY_PATH_KEY] = displayNameByPath;
  }
  config[projectName] = {
    ...(isPlainRecord(config[projectName]) ? config[projectName] : {}),
    manuallyAdded: true,
    originalPath: normalizedPath,
  };
  await saveProjectConfig(config);
  projectIndexDb.upsert(db, {
    projectId: normalizedPath,
    name: projectName,
    displayName: displayName?.trim() || path.basename(normalizedPath) || projectName,
    projectPath: normalizedPath,
    routePath: buildProjectRoutePath(normalizedPath),
    source: 'manual',
    visible: true,
    syncState: 'ready',
  });
  clearProjectDirectoryCache();
  return buildProjectSummary(projectName, normalizedPath, config, true);
}

/**
 * Append projects that only exist through provider session history.
 */
async function appendProviderOnlyProjects(
  projects: LooseRecord[],
  usedNames: Set<string>,
  knownPaths: Set<string>,
  config: LooseRecord,
  lightweightList: boolean,
  hydratedIndexes: { codex: Map<string, LooseRecord[]>; pi: Map<string, LooseRecord[]>; claude: Map<string, LooseRecord[]> } | null,
): Promise<void> {
  const providerCandidates = lightweightList
    ? await collectLightweightProviderOnlyCandidates()
    : await collectHydratedProviderOnlyCandidates(hydratedIndexes);
  let providerOnlyProjectCount = 0;
  for (const candidate of providerCandidates) {
    if (providerOnlyProjectCount >= PROVIDER_ONLY_PROJECT_LIMIT) {
      break;
    }
    const projectPath = String(candidate.projectPath || '').trim();
    if (!projectPath) {
      continue;
    }
    const normalizedPath = normalizeProjectPath(projectPath);
    if (knownPaths.has(normalizedPath)) {
      continue;
    }
    if (!await shouldIncludeProviderOnlyProject(normalizedPath)) {
      await maybeArchiveMissingProviderProject(normalizedPath, candidate.provider);
      continue;
    }
    await maybeClearRestoredProviderProjectArchive(normalizedPath, candidate.provider);
    const projectName = createProjectName(normalizedPath, config, usedNames);
    const project = buildProjectSummary(projectName, normalizedPath, config, false);
    if (!lightweightList) {
      project.codexSessions = candidate.provider === 'codex'
        ? await getCodexSessions(normalizedPath, {
          includeHidden: true,
          providerSessionIndex: hydratedIndexes?.codex,
          skipProviderScan: true,
        })
        : [];
      project.piSessions = candidate.provider === 'pi'
        ? await readProviderSessionsWithinHomeBudget(() => getPiSessions(normalizedPath, {
          includeHidden: true,
          excludeWorkflowChildSessions: true,
          providerSessionIndex: hydratedIndexes?.pi,
          skipProviderScan: true,
        }))
        : [];
      project.claudeSessions = candidate.provider === 'claude'
        ? await getClaudeSessions(normalizedPath, { providerSessionIndex: hydratedIndexes?.claude, skipProviderScan: true })
        : [];
    }
    projects.push(project);
    usedNames.add(projectName);
    knownPaths.add(normalizedPath);
    providerOnlyProjectCount += 1;
  }
}

/**
 * Clear stale archive records once a provider-only cwd exists again.
 */
async function maybeClearRestoredProviderProjectArchive(projectPath: string, source: unknown): Promise<void> {
  const archiveIndex = await loadProjectArchiveIndex();
  const archival = await evaluateProjectArchival({
    projectPath,
    path: projectPath,
    source: String(source || 'provider'),
    archiveIndex,
  });
  if (archival.archiveUpdated) {
    await saveProjectArchiveIndex(archiveIndex);
  }
}

/**
 * Archive provider-only projects whose transcript cwd no longer exists.
 */
async function maybeArchiveMissingProviderProject(projectPath: string, source: unknown): Promise<void> {
  const archiveIndex = await loadProjectArchiveIndex();
  const archival = await evaluateProjectArchival({
    projectPath,
    path: projectPath,
    source: String(source || 'provider'),
    archiveIndex,
  });
  if (archival.archiveUpdated) {
    await saveProjectArchiveIndex(archiveIndex);
  }
}

/**
 * Keep ephemeral test/run directories out of the user project navigation.
 */
async function shouldIncludeProviderOnlyProject(projectPath: string): Promise<boolean> {
  if (isEphemeralProviderProjectPath(projectPath)) {
    return false;
  }
  try {
    const stat = await fs.stat(projectPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Detect temporary ozw-generated workspaces created by tests and transient runs.
 */
function isEphemeralProviderProjectPath(projectPath: string): boolean {
  const normalizedPath = normalizeProjectPath(projectPath);
  const normalizedTmp = normalizeProjectPath(os.tmpdir());
  if (normalizedPath === normalizedTmp || !normalizedPath.startsWith(`${normalizedTmp}${path.sep}`)) {
    return false;
  }
  const relativeToTmp = path.relative(normalizedTmp, normalizedPath);
  const firstSegment = relativeToTmp.split(path.sep).filter(Boolean)[0] || '';
  return /^ozw-pi-/i.test(firstSegment) || (/^Test/i.test(firstSegment) && /[/\\]\d+$/.test(normalizedPath));
}

/**
 * Remove obvious transient projects and disambiguate duplicate display names.
 */
function filterAndDisambiguateProjects(projects: LooseRecord[]): LooseRecord[] {
  const filtered = projects.filter((project) => !isEmptyGoTestProject(project));
  const displayNameCounts = new Map<string, number>();
  for (const project of filtered) {
    const displayName = String(project.displayName || project.name || '');
    displayNameCounts.set(displayName, (displayNameCounts.get(displayName) || 0) + 1);
  }
  return filtered.map((project) => {
    const displayName = String(project.displayName || project.name || '');
    if ((displayNameCounts.get(displayName) || 0) <= 1) {
      return project;
    }
    const parentName = path.basename(path.dirname(String(project.fullPath || project.path || '')));
    return { ...project, displayName: `${displayName} - ${parentName}` };
  });
}

/**
 * Detect empty Go test temp project stubs that should never reach navigation.
 */
function isEmptyGoTestProject(project: LooseRecord): boolean {
  const projectPath = String(project.fullPath || project.path || '');
  const hasSessions = ['sessions', 'codexSessions', 'piSessions', 'opencodeSessions']
    .some((key) => Array.isArray(project[key]) && project[key].length > 0);
  return !hasSessions && __projectDiscoveryForTest.isGoTestTempProjectPath(projectPath);
}

/**
 * Collect provider-only projects from fully hydrated provider session lists.
 */
async function collectHydratedProviderOnlyCandidates(
  hydratedIndexes: { codex: Map<string, LooseRecord[]>; pi: Map<string, LooseRecord[]>; claude: Map<string, LooseRecord[]> } | null,
): Promise<LooseRecord[]> {
  const indexes = hydratedIndexes || await resolveProviderIndexesWithinHomeBudget();
  const providerSessions = [
    ...flattenProviderIndex(indexes.codex),
    ...flattenProviderIndex(indexes.pi),
    ...flattenProviderIndex(indexes.claude),
  ];
  const candidatesByProviderPath = new Map<string, LooseRecord>();
  for (const session of providerSessions) {
    const provider = String(session.provider || '').trim();
    const projectPath = String(session.projectPath || session.cwd || '').trim();
    if (!provider || !projectPath) {
      continue;
    }
    const candidateKey = `${provider}:${normalizeProjectPath(projectPath)}`;
    const existing = candidatesByProviderPath.get(candidateKey);
    const providerSession = { ...session, provider };
    if (existing) {
      existing.providerSessions.push(providerSession);
      existing.lastActivity = Math.max(existing.lastActivity, getSessionActivityMs(providerSession));
      continue;
    }
    candidatesByProviderPath.set(candidateKey, {
      provider,
      projectPath,
      providerSessions: [providerSession],
      lastActivity: getSessionActivityMs(providerSession),
    });
  }
  return [...candidatesByProviderPath.values()].sort(sortProviderCandidatesByActivity);
}

/**
 * Build provider indexes once per getProjects call.
 */
async function resolveProviderIndexesWithinHomeBudget(): Promise<{ codex: Map<string, LooseRecord[]>; pi: Map<string, LooseRecord[]>; claude: Map<string, LooseRecord[]> }> {
  const [codex, pi, claude] = await Promise.all([
    resolveProviderIndexWithinHomeBudget(buildCodexSessionsIndex),
    resolveProviderIndexWithinHomeBudget(buildPiSessionsIndex),
    resolveProviderIndexWithinHomeBudget(buildClaudeSessionsIndex),
  ]);
  return { codex, pi, claude };
}

/**
 * Return provider sessions unless a slow HOME scan exceeds the overview budget.
 */
async function readProviderSessionsWithinHomeBudget(readSessions: () => Promise<LooseRecord[]>): Promise<LooseRecord[]> {
  return runWithinHomeBudget(readSessions, []);
}

/**
 * Return a provider project index unless a slow HOME scan exceeds the overview budget.
 */
async function resolveProviderIndexWithinHomeBudget(readIndex: () => Promise<Map<string, LooseRecord[]>>): Promise<Map<string, LooseRecord[]>> {
  return runWithinHomeBudget(readIndex, new Map<string, LooseRecord[]>());
}

/**
 * Bound expensive provider HOME scans so manual projects still render quickly.
 */
async function runWithinHomeBudget<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), PROVIDER_INDEX_HOME_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Flatten a grouped provider project index into session rows.
 */
function flattenProviderIndex(index: Map<string, LooseRecord[]>): LooseRecord[] {
  return [...index.values()].flat();
}

/**
 * Return provider sessions from a prebuilt index for one project path.
 */
function getIndexedProjectSessions(index: Map<string, LooseRecord[]> | undefined, projectPath: string): LooseRecord[] {
  return index?.get(normalizeProjectPath(projectPath)) || [];
}

/**
 * Collect provider-only projects for the left navigation without hydrating full
 * session arrays into the /api/projects payload.
 */
async function collectLightweightProviderOnlyCandidates(): Promise<LooseRecord[]> {
  const [codexCandidates, piCandidates, claudeCandidates] = await Promise.all([
    collectLightweightProviderCandidates('codex'),
    collectLightweightProviderCandidates('pi'),
    collectLightweightProviderCandidates('claude'),
  ]);
  return [...codexCandidates, ...piCandidates, ...claudeCandidates].sort(sortProviderCandidatesByActivity);
}

/**
 * Parse recent provider transcript headers into project candidates.
 */
async function collectLightweightProviderCandidates(provider: 'codex' | 'pi' | 'claude'): Promise<LooseRecord[]> {
  const files = provider === 'codex'
    ? await listCodexSessionFiles()
    : provider === 'pi' ? await listPiSessionFiles() : await listClaudeSessionFiles();
  const candidatesByPath = new Map<string, LooseRecord>();
  for (const filePath of [...files].reverse().slice(0, LIGHTWEIGHT_PROVIDER_PROJECT_FILE_LIMIT)) {
    let header: LooseRecord | null = null;
    try {
      header = provider === 'codex'
        ? await parseCodexSessionHeader(filePath)
        : provider === 'pi' ? await parsePiSessionHeader(filePath) : await parseClaudeSessionHeader(filePath);
    } catch (error) {
      console.warn(`[Projects] Could not read ${provider} project header ${filePath}:`, error);
      continue;
    }
    const projectPath = String(header?.projectPath || header?.cwd || '').trim();
    if (!projectPath) {
      continue;
    }
    const normalizedPath = normalizeProjectPath(projectPath);
    if (candidatesByPath.has(normalizedPath)) {
      continue;
    }
    const providerSession = {
      ...header,
      provider,
      projectPath,
      cwd: projectPath,
    };
    candidatesByPath.set(normalizedPath, {
      provider,
      projectPath,
      providerSessions: [providerSession],
      lastActivity: getSessionActivityMs(providerSession),
    });
  }
  return [...candidatesByPath.values()];
}

/**
 * Return a comparable activity timestamp for provider project ordering.
 */
function getSessionActivityMs(session: LooseRecord): number {
  const timestamp = session.lastActivity || session.updated_at || session.createdAt || session.timestamp || 0;
  const activityMs = new Date(timestamp).getTime();
  return Number.isFinite(activityMs) ? activityMs : 0;
}

/**
 * Sort provider project candidates by most recent activity first.
 */
function sortProviderCandidatesByActivity(left: LooseRecord, right: LooseRecord): number {
  return Number(right.lastActivity || 0) - Number(left.lastActivity || 0);
}

/**
 * Build a stable project summary object from config and path.
 */
function buildProjectSummary(projectName: string, projectPath: string, config: LooseRecord, manuallyAdded: boolean): LooseRecord {
  const normalizedPath = normalizeProjectPath(projectPath);
  const displayNameByPath = isPlainRecord(config[DISPLAY_NAME_BY_PATH_KEY])
    ? config[DISPLAY_NAME_BY_PATH_KEY]
    : {};
  const displayName = typeof displayNameByPath[normalizedPath] === 'string'
    ? displayNameByPath[normalizedPath]
    : path.basename(normalizedPath) || projectName;
  return {
    name: projectName,
    path: normalizedPath,
    routePath: buildProjectRoutePath(normalizedPath),
    displayName,
    fullPath: normalizedPath,
    isCustomName: typeof displayNameByPath[normalizedPath] === 'string',
    isManuallyAdded: manuallyAdded,
    sessions: [],
    sessionMeta: { hasMore: false, total: 0 },
    codexSessions: [],
    piSessions: [],
    claudeSessions: [],
  };
}

/**
 * Create a stable project config key for a path.
 */
function createProjectName(projectPath: string, config: LooseRecord, extraUsedNames: Set<string> = new Set()): string {
  const basename = path.basename(projectPath) || 'project';
  const safeName = basename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  let candidate = safeName;
  if (config[candidate] || extraUsedNames.has(candidate)) {
    const hash = crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 8);
    candidate = `${safeName}-${hash}`;
  }
  return candidate;
}
