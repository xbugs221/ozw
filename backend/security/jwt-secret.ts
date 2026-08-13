/**
 * PURPOSE: Create and persist the private JWT signing secret in the stable ozw
 * user directory so login tokens survive upgrades and database relocation.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SIGNING_SECRET_BYTES = 32;
const SIGNING_SECRET_FILE_NAME = '.jwt-secret';
const LEGACY_SIGNING_SECRET_SUFFIX = '.jwt-secret';
const CANONICAL_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_DISTINCT_SECRET_BYTES = 16;

let cachedSecret: { filePath: string; value: string } | null = null;

/**
 * Resolve one stable secret file per ozw user environment.
 */
export function resolveJwtSecretPath(env: NodeJS.ProcessEnv = process.env): string {
  const configuredSecretPath = env.OZW_JWT_SECRET_PATH?.trim();
  if (configuredSecretPath) {
    return path.resolve(configuredSecretPath);
  }

  const homeDirectory = env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
  const runtimeHome = env.OZW_HOME?.trim() || path.join(homeDirectory, '.ozw');
  return path.join(path.resolve(runtimeHome), SIGNING_SECRET_FILE_NAME);
}

/**
 * Resolve the former database-adjacent secret path when a persistent database is configured.
 */
function resolveLegacyJwtSecretPath(env: NodeJS.ProcessEnv): string | null {
  const databasePath = env.DATABASE_PATH?.trim();
  if (!databasePath || databasePath === ':memory:' || databasePath.startsWith('file::memory:')) {
    return null;
  }
  return `${path.resolve(databasePath)}${LEGACY_SIGNING_SECRET_SUFFIX}`;
}

/**
 * Read a previously generated secret while rejecting unsafe or corrupt state.
 */
function readPersistedSecret(filePath: string): string {
  const fileStats = fs.lstatSync(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`JWT secret path is not a regular file: ${filePath}`);
  }

  const secret = fs.readFileSync(filePath, 'utf8');
  validatePersistedSecret(secret, filePath);

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o600);
  }
  return secret;
}

/**
 * Require the exact format emitted by randomBytes(32).toString('base64url') and
 * reject obviously low-entropy values instead of silently replacing user state.
 */
function validatePersistedSecret(secret: string, filePath: string): void {
  const decodedSecret = CANONICAL_BASE64URL_PATTERN.test(secret)
    ? Buffer.from(secret, 'base64url')
    : Buffer.alloc(0);
  const isCanonical = decodedSecret.length === SIGNING_SECRET_BYTES
    && decodedSecret.toString('base64url') === secret;
  const hasMinimumDiversity = new Set(decodedSecret).size >= MINIMUM_DISTINCT_SECRET_BYTES;

  if (isCanonical && hasMinimumDiversity) {
    return;
  }

  throw new Error(
    `Invalid JWT secret in ${filePath}: expected canonical unpadded base64url for 32 random bytes. `
    + 'Restore the original secret, or remove this file only if invalidating existing browser sessions is acceptable.',
  );
}

/**
 * Atomically publish a complete random secret so concurrent server processes
 * converge on the same value instead of invalidating each other's tokens.
 */
function publishPersistedSecret(filePath: string, secret: string): string {
  const directoryPath = path.dirname(filePath);
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });

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
 * Generate and atomically publish a new signing secret when no legacy value is available.
 */
function createPersistedSecret(filePath: string): string {
  const secret = crypto.randomBytes(SIGNING_SECRET_BYTES).toString('base64url');
  return publishPersistedSecret(filePath, secret);
}

/**
 * Copy the former database-adjacent secret once so upgrades keep existing browser sessions valid.
 */
function migrateLegacyPersistedSecret(filePath: string, env: NodeJS.ProcessEnv): string | null {
  const legacyPath = resolveLegacyJwtSecretPath(env);
  if (!legacyPath || path.resolve(legacyPath) === path.resolve(filePath) || !fs.existsSync(legacyPath)) {
    return null;
  }
  return publishPersistedSecret(filePath, readPersistedSecret(legacyPath));
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
    : migrateLegacyPersistedSecret(filePath, env) ?? createPersistedSecret(filePath);
  cachedSecret = { filePath, value };
  return value;
}

/**
 * Clear only the in-memory value so tests can simulate a process restart.
 */
export function resetJwtSecretCacheForTest(): void {
  cachedSecret = null;
}
