/**
 * PURPOSE: Maintain the DB-backed project_index read model from manual project
 * config and provider transcript headers.
 */
import crypto from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { db } from '../../database/db.js';
import { projectIndexDb } from '../../project-index-store.js';
import {
  buildProjectRoutePath,
  DISPLAY_NAME_BY_PATH_KEY,
  isPlainRecord,
  loadProjectConfig,
  normalizeProjectPath,
  type LooseRecord,
} from './project-config-read-model.js';
import {
  listCodexSessionFiles,
  listPiSessionFiles,
  parseCodexSessionHeader,
  parsePiSessionHeader,
  listClaudeSessionFiles,
  parseClaudeSessionHeader,
} from './provider-transcript-read-model.js';
import { providerSessionIndexDb } from '../../provider-session-index-store.js';
import { sessionAttentionDb } from '../../session-attention-store.js';
import { selectProviderBackfillFiles } from './project-index-backfill-selection.js';

const BACKFILL_FILE_LIMIT = (() => {
  const parsed = Number.parseInt(process.env.PROJECT_INDEX_BACKFILL_FILE_LIMIT || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
})();

type ProjectIndexReconcileResult = {
  hiddenCount: number;
};

/**
 * Return whether a project path currently points at a directory.
 */
async function projectDirectoryExists(projectPath: string): Promise<boolean> {
  /**
   * PURPOSE: Keep stale provider/manual rows out of DB-backed navigation
   * without doing filesystem checks during HTTP project list reads.
   */
  try {
    const stat = await fs.stat(projectPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Detect transient ozw-pi workspaces directly under the system temp directory.
 */
function isEphemeralProviderProjectPath(projectPath: string): boolean {
  /**
   * PURPOSE: Keep the DB-backed sidebar aligned with the legacy provider-only
   * visibility rule before rows are written to project_index.
   */
  const normalizedPath = normalizeProjectPath(projectPath);
  const normalizedTmp = normalizeProjectPath(os.tmpdir());
  if (normalizedPath === normalizedTmp || !normalizedPath.startsWith(`${normalizedTmp}${path.sep}`)) {
    return false;
  }
  const relativeToTmp = path.relative(normalizedTmp, normalizedPath);
  const firstSegment = relativeToTmp.split(path.sep).filter(Boolean)[0] || '';
  return /^ozw-pi-/i.test(firstSegment);
}

/**
 * Create a stable project name for DB rows that came from provider history.
 */
function createProjectName(projectPath: string): string {
  /**
   * PURPOSE: Keep generated names deterministic without loading the legacy
   * discovery read model.
   */
  const basename = path.basename(projectPath) || 'project';
  const safeName = basename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const hash = crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 8);
  return `${safeName}-${hash}`;
}

/**
 * Return display name overrides from project config.
 */
function getDisplayName(projectPath: string, config: LooseRecord): string {
  /**
   * PURPOSE: Preserve user-facing labels when the sidebar switches to the DB
   * read model.
   */
  const displayNameByPath = isPlainRecord(config[DISPLAY_NAME_BY_PATH_KEY])
    ? config[DISPLAY_NAME_BY_PATH_KEY]
    : {};
  return typeof displayNameByPath[projectPath] === 'string'
    ? displayNameByPath[projectPath]
    : path.basename(projectPath) || createProjectName(projectPath);
}

/**
 * Collect currently configured manual project paths from global config.
 */
function collectConfiguredManualProjectPaths(config: LooseRecord): Set<string> {
  /**
   * PURPOSE: Detect manual rows left behind after tests, config edits, or
   * project deletion without parsing config inside request handlers.
   */
  const paths = new Set<string>();
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!isPlainRecord(projectConfig) || projectConfig.manuallyAdded !== true) {
      continue;
    }
    const projectPath = normalizeProjectPath(typeof projectConfig.originalPath === 'string'
      ? projectConfig.originalPath
      : projectName.replace(/-/g, '/'));
    if (projectPath) {
      paths.add(projectPath);
    }
  }
  return paths;
}

/**
 * Hide visible project_index rows that no longer match disk/config/session truth.
 */
export async function reconcileProjectIndex(config: LooseRecord | null = null): Promise<ProjectIndexReconcileResult> {
  /**
   * PURPOSE: Make project_index an eventually consistent read model instead of
   * an append-only cache that can keep showing deleted test or provider paths.
   */
  const effectiveConfig = config || await loadProjectConfig();
  const configuredManualPaths = collectConfiguredManualProjectPaths(effectiveConfig);
  const rows = projectIndexDb.listRecords(db, { visibleOnly: true });
  let hiddenCount = 0;

  for (const row of rows) {
    const projectPath = normalizeProjectPath(String(row.projectPath || ''));
    if (!projectPath) {
      continue;
    }

    const source = String(row.source || '');
    let hiddenReason = '';
    if (source === 'manual') {
      if (!configuredManualPaths.has(projectPath)) {
        hiddenReason = 'manual-not-in-config';
      } else if (!await projectDirectoryExists(projectPath)) {
        hiddenReason = 'manual-path-missing';
      }
    } else if (source === 'provider') {
      if (isEphemeralProviderProjectPath(projectPath)) {
        hiddenReason = 'ephemeral-ozw-pi-temp';
      } else if (!await projectDirectoryExists(projectPath)) {
        hiddenReason = 'provider-path-missing';
      } else if (providerSessionIndexDb.countForProject(db, projectPath) === 0) {
        hiddenReason = 'provider-session-missing';
      }
    } else if (!await projectDirectoryExists(projectPath)) {
      hiddenReason = 'project-path-missing';
    }

    if (!hiddenReason) {
      continue;
    }
    projectIndexDb.setVisibility(db, projectPath, false, hiddenReason);
    hiddenCount += 1;
  }

  return { hiddenCount };
}

/**
 * Upsert one project row derived from a provider session header.
 */
export async function upsertProjectIndexFromProviderSession(session: LooseRecord | null | undefined): Promise<string> {
  /**
   * PURPOSE: Let watcher and backfill updates share one projection rule.
   */
  const projectPath = normalizeProjectPath(String(session?.projectPath || session?.cwd || '').trim());
  if (!projectPath) {
    return '';
  }
  const name = createProjectName(projectPath);
  if (isEphemeralProviderProjectPath(projectPath)) {
    projectIndexDb.upsert(db, {
      projectId: projectPath,
      name,
      displayName: path.basename(projectPath) || name,
      projectPath,
      routePath: buildProjectRoutePath(projectPath),
      source: 'provider',
      visible: false,
      visibilityReason: 'ephemeral-ozw-pi-temp',
      lastActivity: session?.lastActivity || session?.updated_at || session?.createdAt || session?.timestamp || null,
      syncState: 'hidden',
    });
    return '';
  }
  if (!await projectDirectoryExists(projectPath)) {
    projectIndexDb.upsert(db, {
      projectId: projectPath,
      name,
      displayName: path.basename(projectPath) || name,
      projectPath,
      routePath: buildProjectRoutePath(projectPath),
      source: 'provider',
      visible: false,
      visibilityReason: 'provider-path-missing',
      lastActivity: session?.lastActivity || session?.updated_at || session?.createdAt || session?.timestamp || null,
      syncState: 'hidden',
    });
    return '';
  }
  const config = await loadProjectConfig();
  projectIndexDb.upsert(db, {
    projectId: projectPath,
    name,
    displayName: getDisplayName(projectPath, config),
    projectPath,
    routePath: buildProjectRoutePath(projectPath),
    source: 'provider',
    visible: true,
    lastActivity: session?.lastActivity || session?.updated_at || session?.createdAt || session?.timestamp || null,
    syncState: 'ready',
  });
  return projectPath;
}

/**
 * Hide a provider-derived project row when its last provider session disappears.
 */
export function hideProviderProjectIndex(projectPath: string, reason = 'provider-session-deleted'): void {
  /**
   * PURPOSE: Let watcher unlink events remove stale provider-only projects from
   * the lightweight DB read model without affecting manually pinned projects.
   */
  projectIndexDb.setProviderVisibility(db, projectPath, false, reason);
}

/**
 * Upsert one provider session header into the provider-session read model.
 */
function upsertProviderSessionIndexFromHeader(provider: 'codex' | 'pi' | 'claude', session: LooseRecord | null | undefined): void {
  /**
   * PURPOSE: Keep startup backfill self-contained instead of depending on the
   * project-domain facade to configure provider-session read-model helpers.
   */
  if (!session?.id || !session.filePath) {
    return;
  }
  providerSessionIndexDb.upsert(db, {
    provider,
    id: session.id,
    sourceSessionId: session.sourceSessionId || session.source_session_id || null,
    origin: session.origin || null,
    projectPath: session.projectPath || session.cwd || '',
    summary: session.summary || session.title || null,
    title: session.title || session.summary || null,
    routeTitle: session.routeTitle || session.title || session.summary || null,
    model: session.model || null,
    thread: session.thread || null,
    sessionFileName: session.sessionFileName || session.session_file_name || null,
    filePath: session.filePath,
    createdAt: session.createdAt || session.created_at || null,
    lastActivity: session.lastActivity || session.updated_at || session.updatedAt || null,
    messageCount: typeof session.messageCount === 'number' ? session.messageCount : null,
    messageCountKnown: session.messageCountKnown === true,
    fileMtimeMs: typeof session.fileMtimeMs === 'number' ? session.fileMtimeMs : null,
  });
}

/**
 * Migrate a legacy project-chat pending flag into the SQLite attention cursor.
 */
async function migrateLegacyPendingSession(provider: 'codex' | 'pi' | 'claude', session: LooseRecord | null | undefined): Promise<void> {
  /** PURPOSE: Preserve existing user intent once, while all subsequent writes use the database boundary. */
  const projectPath = String(session?.projectPath || session?.cwd || '').trim();
  const sessionId = String(session?.id || '').trim();
  if (!projectPath || !sessionId) return;
  const config = await loadProjectConfig(projectPath);
  const chatRecords = Object.values(isPlainRecord(config.chat) ? config.chat : {}).filter(isPlainRecord);
  const legacyPending = chatRecords.some((record) => (
    String(record.provider || 'codex') === provider
    && (String(record.providerSessionId || '') === sessionId || String(record.sessionId || '') === sessionId)
    && record.ui?.pending === true
  ));
  sessionAttentionDb.migrateLegacyPending(db, provider, sessionId, legacyPending);
}

/**
 * Upsert manually configured projects into the DB read model.
 */
async function backfillManualProjects(config: LooseRecord): Promise<number> {
  /**
   * PURPOSE: Ensure user-pinned projects remain visible even before any
   * provider transcript exists.
   */
  let count = 0;
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!isPlainRecord(projectConfig) || projectConfig.manuallyAdded !== true) {
      continue;
    }
    const projectPath = normalizeProjectPath(typeof projectConfig.originalPath === 'string'
      ? projectConfig.originalPath
      : projectName.replace(/-/g, '/'));
    if (!projectPath) {
      continue;
    }
    const visible = await projectDirectoryExists(projectPath);
    projectIndexDb.upsert(db, {
      projectId: projectPath,
      name: projectName,
      displayName: getDisplayName(projectPath, config),
      projectPath,
      routePath: buildProjectRoutePath(projectPath),
      source: 'manual',
      visible,
      visibilityReason: visible ? null : 'manual-path-missing',
      syncState: visible ? 'ready' : 'hidden',
    });
    if (visible) {
      count += 1;
    }
  }
  return count;
}

/**
 * Backfill project_index from existing provider transcript headers.
 */
export async function backfillProjectIndex(): Promise<{ manualCount: number; providerCount: number; hiddenCount: number }> {
  /**
   * PURPOSE: Populate project and provider-session DB read models at startup so
   * CLI transcripts written while ozw was offline become visible again.
   */
  const config = await loadProjectConfig();
  const manualCount = await backfillManualProjects(config);
  let providerCount = 0;
  const [codexFiles, piFiles, claudeFiles] = await Promise.all([
    listCodexSessionFiles(),
    listPiSessionFiles(),
    listClaudeSessionFiles(),
  ]);
  const providerFiles = selectProviderBackfillFiles(codexFiles, piFiles, claudeFiles, BACKFILL_FILE_LIMIT);
  for (const { provider, filePath } of providerFiles) {
    try {
      const session = provider === 'codex'
        ? await parseCodexSessionHeader(filePath)
        : provider === 'pi' ? await parsePiSessionHeader(filePath) : await parseClaudeSessionHeader(filePath);
      upsertProviderSessionIndexFromHeader(provider, session);
      await migrateLegacyPendingSession(provider, session);
      const projectPath = await upsertProjectIndexFromProviderSession(session);
      if (projectPath) {
        providerCount += 1;
      }
    } catch (error) {
      console.warn(`[ProjectIndex] Could not backfill ${provider} file ${filePath}:`, error);
    }
  }
  const reconcileResult = await reconcileProjectIndex(config);
  console.info(`[ProjectIndex] Backfill complete: manual=${manualCount}, provider=${providerCount}, hidden=${reconcileResult.hiddenCount}`);
  return { manualCount, providerCount, hiddenCount: reconcileResult.hiddenCount };
}
