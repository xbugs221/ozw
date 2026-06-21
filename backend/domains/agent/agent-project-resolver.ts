/**
 * PURPOSE: Resolve agent project path inputs before session execution starts.
 */

import { validateWorkspacePath } from '../../workspace-paths.js';

export async function resolveAgentProjectPath(projectPath: string | null | undefined): Promise<string> {
  /** Validate and normalize a project path inside the configured workspace boundary. */
  const normalizedPath = typeof projectPath === 'string' ? projectPath.trim() : '';
  if (!normalizedPath) {
    throw new Error('projectPath is required for existing project mode');
  }

  const validation = await validateWorkspacePath(normalizedPath);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid project path');
  }

  if (!validation.resolvedPath) {
    throw new Error('Invalid project path');
  }

  return validation.resolvedPath;
}
