/**
 * PURPOSE: Resolve external executable paths from the current service process
 * PATH without relying on shell aliases or user-specific absolute paths.
 */
import fs from 'fs';
import path from 'path';

/**
 * Return candidate executable suffixes for the current platform.
 */
function getExecutableSuffixes(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  /**
   * Windows resolves bare commands through PATHEXT; Unix commands are exact
   * names and must have execute bits.
   */
  if (platform !== 'win32') {
    return [''];
  }
  const pathExt = env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return pathExt.split(';').filter(Boolean);
}

/**
 * Check whether one file is usable as an executable by the service process.
 */
function isExecutable(filePath: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (platform === 'win32') {
      return fs.statSync(filePath).isFile();
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the first executable matching commandName from env.PATH.
 */
export function resolveExecutablePath(commandName: string, { env = process.env, platform = process.platform }: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): string {
  if (!commandName || commandName.includes('/') || commandName.includes('\\')) {
    return isExecutable(commandName, platform) ? path.resolve(commandName) : '';
  }
  const searchPath = env.PATH || '';
  const pathEntries = searchPath.split(path.delimiter).filter(Boolean);
  const suffixes = getExecutableSuffixes(env, platform);
  const commandHasExt = platform === 'win32' && path.extname(commandName);
  for (const dir of pathEntries) {
    const candidates = commandHasExt ? [path.join(dir, commandName)] : suffixes.map((suffix) => path.join(dir, `${commandName}${suffix}`));
    for (const candidate of candidates) {
      if (isExecutable(candidate, platform)) {
        return candidate;
      }
    }
  }
  return '';
}
