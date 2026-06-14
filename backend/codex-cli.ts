/**
 * PURPOSE: Resolve the Codex CLI executable for chat turns and Codex MCP
 * management without relying on npm-script PATH injection.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVER_DIR, '..');

/**
 * Return true when a path points to a runnable file for the current platform.
 */
function isRunnableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build platform-specific executable names for a command.
 */
function getExecutableNames(commandName: string): string[] {
  if (process.platform !== 'win32') {
    return [commandName];
  }

  const extension = path.extname(commandName);
  if (extension) {
    return [commandName];
  }

  const pathExt = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return [
    commandName,
    ...pathExt
      .split(';')
      .map((ext) => ext.trim())
      .filter(Boolean)
      .map((ext) => `${commandName}${ext.toLowerCase()}`),
  ];
}

/**
 * Resolve one command name through an explicit PATH string.
 */
function resolveCommandFromPath(commandName: string, pathValue: string): string {
  if (!commandName || commandName.includes(path.sep) || (path.sep === '/' && commandName.includes('\\'))) {
    return isRunnableFile(commandName) ? commandName : '';
  }

  for (const dir of String(pathValue || '').split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    for (const executableName of getExecutableNames(commandName)) {
      const candidate = path.join(dir, executableName);
      if (isRunnableFile(candidate)) {
        return candidate;
      }
    }
  }
  return '';
}

/**
 * Return project roots whose local node_modules/.bin directory may contain
 * @openai/codex when the server process was not started through an npm script.
 */
function getLocalBinRoots(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string[] {
  const roots = [cwd, APP_ROOT, env.INIT_CWD].filter(Boolean).map((entry) => path.resolve(entry!));
  return [...new Set(roots)];
}

/**
 * Resolve the Codex CLI path, preferring explicit configuration, then PATH,
 * then local dependency bins installed beside this application.
 */
export function resolveCodexCliPath(options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): string {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const override = typeof env.CODEX_CLI_PATH === 'string' ? env.CODEX_CLI_PATH.trim() : '';
  if (override) {
    return override;
  }

  const fromPath = resolveCommandFromPath('codex', env.PATH || '');
  if (fromPath) {
    return fromPath;
  }

  for (const root of getLocalBinRoots(env, cwd)) {
    const binDir = path.join(root, 'node_modules', '.bin');
    for (const executableName of getExecutableNames('codex')) {
      const candidate = path.join(binDir, executableName);
      if (isRunnableFile(candidate)) {
        return candidate;
      }
    }
  }

  return 'codex';
}

/**
 * Convert a child_process ENOENT into an actionable deployment error.
 */
export function formatCodexCliNotFoundMessage(cliPath: string, env: NodeJS.ProcessEnv = process.env): string {
  return [
    `Codex CLI executable not found: ${cliPath || 'codex'}.`,
    'Install @openai/codex for this deployment, expose codex on the service PATH, or set CODEX_CLI_PATH to the absolute codex executable path.',
    `PATH=${env.PATH || ''}`,
    `HOME=${env.HOME || os.homedir()}`,
  ].join(' ');
}

export const __codexCliInternalsForTest = {
  resolveCommandFromPath,
  getExecutableNames,
};
