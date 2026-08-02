/**
 * PURPOSE: Create and persist the private JWT signing secret beside the active
 * database so login tokens survive process restarts without user configuration.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SIGNING_SECRET_BYTES = 32;
const SIGNING_SECRET_SUFFIX = '.jwt-secret';

let cachedSecret: { filePath: string; value: string } | null = null;

/**
 * Resolve one stable secret file per database-backed ozw instance.
 */
export function resolveJwtSecretPath(env: NodeJS.ProcessEnv = process.env): string {
  const databasePath = env.DATABASE_PATH?.trim();
  if (databasePath && databasePath !== ':memory:' && !databasePath.startsWith('file::memory:')) {
    return `${path.resolve(databasePath)}${SIGNING_SECRET_SUFFIX}`;
  }

  const homeDirectory = env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
  return path.join(homeDirectory, '.ozw', `ozw.db${SIGNING_SECRET_SUFFIX}`);
}

/**
 * Read a previously generated secret while rejecting unsafe or corrupt state.
 */
function readPersistedSecret(filePath: string): string {
  const fileStats = fs.lstatSync(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`JWT secret path is not a regular file: ${filePath}`);
  }

  const secret = fs.readFileSync(filePath, 'utf8').trim();
  if (!secret) {
    throw new Error(`JWT secret file is empty: ${filePath}`);
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o600);
  }
  return secret;
}

/**
 * Atomically publish a complete random secret so concurrent server processes
 * converge on the same value instead of invalidating each other's tokens.
 */
function createPersistedSecret(filePath: string): string {
  const directoryPath = path.dirname(filePath);
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });

  const secret = crypto.randomBytes(SIGNING_SECRET_BYTES).toString('base64url');
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, secret, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      fs.linkSync(temporaryPath, filePath);
      return secret;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') {
        throw error;
      }
      return readPersistedSecret(filePath);
    }
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

/**
 * Return the stable automatically managed JWT signing secret for this process.
 */
export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const filePath = resolveJwtSecretPath(env);
  if (cachedSecret?.filePath === filePath) {
    return cachedSecret.value;
  }

  const value = fs.existsSync(filePath)
    ? readPersistedSecret(filePath)
    : createPersistedSecret(filePath);
  cachedSecret = { filePath, value };
  return value;
}

/**
 * Clear only the in-memory value so tests can simulate a process restart.
 */
export function resetJwtSecretCacheForTest(): void {
  cachedSecret = null;
}
