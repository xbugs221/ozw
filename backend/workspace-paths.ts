/**
 * PURPOSE: Provide shared workspace path validation for project, agent, and Git
 * entry points before they touch filesystem or provider runtimes.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || os.homedir();

export const FORBIDDEN_PATHS = [
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/dev',
  '/proc',
  '/sys',
  '/var',
  '/boot',
  '/root',
  '/lib',
  '/lib64',
  '/opt',
  '/tmp',
  '/run',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin',
];

export type WorkspacePathValidation = {
  valid: boolean;
  resolvedPath?: string;
  error?: string;
};

function isPathAtOrBelow(candidatePath: string, parentPath: string): boolean {
  /**
   * PURPOSE: Match filesystem paths only on directory boundaries so sibling
   * names with the same prefix are not treated as descendants.
   */
  const normalizedCandidate = path.normalize(candidatePath);
  const normalizedParent = path.normalize(parentPath);
  const relativePath = path.relative(normalizedParent, normalizedCandidate);
  return relativePath === '' || (Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function resolveFlowrkspaceInputPath(requestedPath: string): string {
  /**
   * PURPOSE: Interpret browser-entered workspace paths the same way across
   * browsing, folder creation, and project creation.
   */
  if (requestedPath === '~') {
    return path.resolve(WORKSPACES_ROOT);
  }

  if (requestedPath.startsWith('~/') || requestedPath.startsWith('~\\')) {
    return path.resolve(WORKSPACES_ROOT, requestedPath.slice(2));
  }

  return path.resolve(requestedPath);
}

export async function validateWorkspacePath(requestedPath: string): Promise<WorkspacePathValidation> {
  /**
   * PURPOSE: Resolve a requested workspace path and reject system directories,
   * workspace-root escapes, and symlink escapes.
   */
  try {
    const absolutePath = resolveFlowrkspaceInputPath(requestedPath);
    const normalizedPath = path.normalize(absolutePath);

    if (FORBIDDEN_PATHS.includes(normalizedPath) || normalizedPath === '/') {
      return {
        valid: false,
        error: 'Cannot use system-critical directories as workspace locations',
      };
    }

    for (const forbidden of FORBIDDEN_PATHS) {
      if (forbidden === '/') {
        continue;
      }

      if (isPathAtOrBelow(normalizedPath, forbidden)) {
        if (
          forbidden === '/var' &&
          (isPathAtOrBelow(normalizedPath, '/var/tmp') || isPathAtOrBelow(normalizedPath, '/var/folders'))
        ) {
          continue;
        }

        return {
          valid: false,
          error: `Cannot create workspace in system directory: ${forbidden}`,
        };
      }
    }

    let realPath: string;
    try {
      await fs.access(absolutePath);
      realPath = await fs.realpath(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const parentPath = path.dirname(absolutePath);
        try {
          const parentRealPath = await fs.realpath(parentPath);
          realPath = path.join(parentRealPath, path.basename(absolutePath));
        } catch (parentError) {
          if ((parentError as NodeJS.ErrnoException).code === 'ENOENT') {
            realPath = absolutePath;
          } else {
            throw parentError;
          }
        }
      } else {
        throw error;
      }
    }

    const resolvedWorkspaceRoot = await fs.realpath(WORKSPACES_ROOT);
    if (!realPath.startsWith(resolvedWorkspaceRoot + path.sep) && realPath !== resolvedWorkspaceRoot) {
      return {
        valid: false,
        error: `Workspace path must be within the allowed workspace root: ${WORKSPACES_ROOT}`,
      };
    }

    try {
      await fs.access(absolutePath);
      const stats = await fs.lstat(absolutePath);

      if (stats.isSymbolicLink()) {
        const linkTarget = await fs.readlink(absolutePath);
        const resolvedTarget = path.resolve(path.dirname(absolutePath), linkTarget);
        const realTarget = await fs.realpath(resolvedTarget);

        if (!realTarget.startsWith(resolvedWorkspaceRoot + path.sep) && realTarget !== resolvedWorkspaceRoot) {
          return {
            valid: false,
            error: 'Symlink target is outside the allowed workspace root',
          };
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return {
      valid: true,
      resolvedPath: realPath,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Path validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
