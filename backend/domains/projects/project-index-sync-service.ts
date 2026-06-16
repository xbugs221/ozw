/**
 * PURPOSE: Maintain the DB-backed project_index read model from manual project
 * config and provider transcript headers.
 */
import crypto from 'crypto';
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
} from './provider-transcript-read-model.js';

const BACKFILL_FILE_LIMIT = (() => {
  const parsed = Number.parseInt(process.env.PROJECT_INDEX_BACKFILL_FILE_LIMIT || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
})();

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
  if (isEphemeralProviderProjectPath(projectPath)) {
    projectIndexDb.upsert(db, {
      projectId: projectPath,
      name: createProjectName(projectPath),
      displayName: path.basename(projectPath) || createProjectName(projectPath),
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
  const config = await loadProjectConfig();
  const name = createProjectName(projectPath);
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
    projectIndexDb.upsert(db, {
      projectId: projectPath,
      name: projectName,
      displayName: getDisplayName(projectPath, config),
      projectPath,
      routePath: buildProjectRoutePath(projectPath),
      source: 'manual',
      visible: true,
      syncState: 'ready',
    });
    count += 1;
  }
  return count;
}

/**
 * Backfill project_index from existing provider transcript headers.
 */
export async function backfillProjectIndex(): Promise<{ manualCount: number; providerCount: number }> {
  /**
   * PURPOSE: Populate the DB read model at startup so /api/projects can stay
   * DB-only during request handling.
   */
  const config = await loadProjectConfig();
  const manualCount = await backfillManualProjects(config);
  let providerCount = 0;
  const providerFiles = [
    ...(await listCodexSessionFiles()).map((filePath) => ({ provider: 'codex' as const, filePath })),
    ...(await listPiSessionFiles()).map((filePath) => ({ provider: 'pi' as const, filePath })),
  ];
  for (const { provider, filePath } of providerFiles.reverse().slice(0, BACKFILL_FILE_LIMIT)) {
    try {
      const session = provider === 'codex'
        ? await parseCodexSessionHeader(filePath)
        : await parsePiSessionHeader(filePath);
      const projectPath = await upsertProjectIndexFromProviderSession(session);
      if (projectPath) {
        providerCount += 1;
      }
    } catch (error) {
      console.warn(`[ProjectIndex] Could not backfill ${provider} file ${filePath}:`, error);
    }
  }
  console.info(`[ProjectIndex] Backfill complete: manual=${manualCount}, provider=${providerCount}`);
  return { manualCount, providerCount };
}
