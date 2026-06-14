/**
 * PURPOSE: Resolve oz flow user-state runtime paths so ozw reads the same sealed
 * run state files that the external runner publishes for each repository.
 */
import crypto from 'crypto';
import os from 'os';
import path from 'path';

/**
 * Normalize a project path before deriving the oz flow repository key.
 */
export function resolveFlowProjectPath(projectPath: string): string {
  return path.resolve(String(projectPath || '') || '.');
}

/**
 * Convert a repository basename into the sanitized prefix used by oz flow.
 */
export function sanitizeFlowRepoBasename(projectPath: string): string {
  const basename = path.basename(resolveFlowProjectPath(projectPath)).toLowerCase();
  return basename.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
}

/**
 * Derive the oz flow repository key for a project path.
 */
export function resolveFlowRepoKey(projectPath: string): string {
  const absoluteProjectPath = resolveFlowProjectPath(projectPath);
  const hash = crypto.createHash('sha1').update(absoluteProjectPath).digest('hex').slice(0, 10);
  return `${sanitizeFlowRepoBasename(absoluteProjectPath)}-${hash}`;
}

/**
 * Resolve the root directory where oz flow stores repository-scoped runtime state.
 */
export function resolveFlowStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.XDG_STATE_HOME) {
    return path.join(env.XDG_STATE_HOME, 'oz', 'flow');
  }
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'oz', 'flow');
  }
  return path.join(os.homedir(), '.local', 'state', 'oz', 'flow');
}

/**
 * Resolve the runs directory for a project in the oz flow user-state tree.
 */
export function resolveFlowRunsRoot(projectPath: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveFlowStateRoot(env), 'repos', resolveFlowRepoKey(projectPath), 'runs');
}

/**
 * Resolve one run directory for a project.
 */
export function resolveFlowRunDir(projectPath: string, runId: string | number, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveFlowRunsRoot(projectPath, env), String(runId || ''));
}

/**
 * Resolve the sealed state file path for one oz flow run.
 */
export function resolveFlowRunStatePath(projectPath: string, runId: string | number, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveFlowRunDir(projectPath, runId, env), 'state.json');
}

/**
 * Resolve the batches directory for a project in the oz flow user-state tree.
 */
export function resolveFlowBatchesRoot(projectPath: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveFlowStateRoot(env), 'repos', resolveFlowRepoKey(projectPath), 'batches');
}

/**
 * Resolve one batch state file path.
 */
export function resolveFlowBatchStatePath(projectPath: string, batchId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveFlowBatchesRoot(projectPath, env), String(batchId || ''), 'state.json');
}

/**
 * Render state paths compactly in diagnostics when they live under the state root.
 */
export function formatFlowStatePathForDiagnostics(statePath: string, env: NodeJS.ProcessEnv = process.env): string {
  const stateRoot = resolveFlowStateRoot(env);
  const relative = path.relative(stateRoot, statePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return path.join('${XDG_STATE_HOME:-~/.local/state}', 'oz', 'flow', relative).replace(/\\/g, '/');
  }
  return String(statePath || '').replace(/\\/g, '/');
}
