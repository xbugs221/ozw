/**
 * PURPOSE: Resolve the effective project working directory for chat requests so
 * provider backends never fall back to the server process cwd by mistake.
 */

/**
 * Resolve chat request paths from explicit cwd/projectPath first, then an
 * optional project-name lookup supplied by the caller.
 *
 * @param {object} options - Chat request options from the websocket payload.
 * @param {(projectName: string) => Promise<string>} resolveProjectDirectory - Project path resolver.
 * @returns {Promise<object>} Normalized options with cwd/projectPath populated when possible.
 */
export async function resolveChatProjectOptions(
  options: { cwd?: string; projectPath?: string; projectName?: string } = {},
  resolveProjectDirectory: (projectName: string) => Promise<string>
) {
  const explicitPath = options.cwd || options.projectPath;
  if (explicitPath) {
    return {
      ...options,
      cwd: explicitPath,
      projectPath: explicitPath,
    };
  }

  const projectName = typeof options.projectName === 'string' ? options.projectName.trim() : '';
  if (!projectName || typeof resolveProjectDirectory !== 'function') {
    return options;
  }

  try {
    const resolvedPath = await resolveProjectDirectory(projectName);
    if (!resolvedPath) {
      return options;
    }

    return {
      ...options,
      cwd: resolvedPath,
      projectPath: resolvedPath,
    };
  } catch {
    return options;
  }
}
