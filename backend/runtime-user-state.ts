/**
 * 文件目的：安全初始化 ozw 的用户态目录、持久化访问令牌和默认数据路径。
 */
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getJwtSecret, resolveJwtSecretPath } from './security/jwt-secret.js';

const ACCESS_TOKEN_LENGTH = 32;
const ENV_FILE_NAME = '.env';
const DATABASE_FILE_NAME = 'ozw.db';
const JWT_SECRET_FILE_NAME = '.jwt-secret';
const ACCESS_TOKEN_SEED_FILE_NAME = '.access-token';

export interface RuntimeUserPaths {
  homePath: string;
  envPath: string;
  databasePath: string;
  jwtSecretPath: string;
}

export interface RuntimeUserState extends RuntimeUserPaths {
  accessToken: string;
  accessTokenGenerated: boolean;
}

export interface RuntimeUserStateInspection extends RuntimeUserPaths {
  envExists: boolean;
  databasePath: string;
  accessTokenConfigured: boolean;
  accessTokenValid: boolean;
  effectiveEnv: NodeJS.ProcessEnv;
}

export interface RuntimeUserStateOptions {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  legacyEnvPath?: string;
}

interface RuntimeEnvFile {
  exists: boolean;
  contents: string;
}

interface PublishedAccessToken {
  token: string;
  published: boolean;
}

export class RuntimeUserStateError extends Error {
  /**
   * PURPOSE: Mark invalid or unsafe persisted user configuration with a stable error type.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeUserStateError';
  }
}

/**
 * PURPOSE: Resolve every mutable runtime path from OZW_HOME, or ~/.ozw when it is absent.
 */
export function resolveRuntimeUserPaths(options: RuntimeUserStateOptions = {}): RuntimeUserPaths {
  const env = options.env ?? process.env;
  const configuredHome = env.OZW_HOME?.trim();
  const baseHome = options.homeDirectory ?? os.homedir();
  const homePath = path.resolve(configuredHome || path.join(baseHome, '.ozw'));
  if (configuredHome) {
    const currentDirectory = path.resolve(process.cwd());
    const unsafePaths = new Set([path.parse(homePath).root, path.resolve(baseHome), currentDirectory]);
    const ownsCurrentDirectory = currentDirectory.startsWith(`${homePath}${path.sep}`);
    if (unsafePaths.has(homePath) || ownsCurrentDirectory) {
      throw new RuntimeUserStateError(`OZW_HOME must point to a dedicated subdirectory, not ${homePath}.`);
    }
  }

  return {
    homePath,
    envPath: path.join(homePath, ENV_FILE_NAME),
    databasePath: path.join(homePath, DATABASE_FILE_NAME),
    jwtSecretPath: path.join(homePath, JWT_SECRET_FILE_NAME),
  };
}

/**
 * PURPOSE: Parse the small KEY=VALUE user configuration format while preserving the first value.
 */
function parseEnvFile(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (key && !values.has(key)) {
      values.set(key, trimmed.slice(separator + 1).trim());
    }
  }
  return values;
}

/**
 * PURPOSE: Read the first non-empty token candidate when concurrent appenders follow an empty placeholder.
 */
function findFirstConfiguredAccessToken(contents: string): string | undefined {
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf('=');
    if (separator <= 0 || trimmed.slice(0, separator).trim() !== 'OZW_ACCESS_TOKEN') continue;
    const value = trimmed.slice(separator + 1).trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * PURPOSE: Replace one persisted setting without duplicating keys or discarding unrelated user edits.
 */
function setEnvFileValue(contents: string, targetKey: string, value: string): string {
  const output: string[] = [];
  let replaced = false;
  const lines = contents.split(/\r?\n/u);
  while (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf('=');
    const key = separator > 0 ? trimmed.slice(0, separator).trim() : '';
    if (key === targetKey) {
      if (!replaced) output.push(`${targetKey}=${value}`);
      replaced = true;
      continue;
    }
    if (line || output.length > 0) output.push(line);
  }
  if (!replaced) output.push(`${targetKey}=${value}`);
  while (output.at(-1) === '') output.pop();
  return `${output.join('\n')}\n`;
}

/**
 * PURPOSE: Reject malformed access credentials without silently replacing an existing secret.
 */
function validateAccessToken(value: string, source: string): string {
  if (Array.from(value).length !== ACCESS_TOKEN_LENGTH) {
    throw new RuntimeUserStateError(
      `Invalid OZW_ACCESS_TOKEN in ${source}: expected exactly ${ACCESS_TOKEN_LENGTH} characters; ` +
        'set a valid token or remove the invalid entry before restarting ozw.',
    );
  }
  return value;
}

/**
 * PURPOSE: Generate a printable 32-character credential from a cryptographically secure source.
 */
function generateAccessToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * PURPOSE: Ensure a path is a regular user-owned file and reduce its permissions to 0600.
 */
async function secureExistingEnvFile(envPath: string): Promise<RuntimeEnvFile> {
  let fileStats;
  try {
    fileStats = await fs.lstat(envPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return { exists: false, contents: '' };
    throw error;
  }

  if (!fileStats.isFile()) {
    throw new RuntimeUserStateError(`Cannot use ozw configuration because ${envPath} is not a regular file.`);
  }
  if (process.platform !== 'win32') await fs.chmod(envPath, 0o600);
  return { exists: true, contents: await fs.readFile(envPath, 'utf8') };
}

/**
 * PURPOSE: Read status configuration without creating files or changing filesystem permissions.
 */
async function inspectExistingEnvFile(envPath: string): Promise<RuntimeEnvFile> {
  try {
    const fileStats = await fs.lstat(envPath);
    if (!fileStats.isFile()) {
      throw new RuntimeUserStateError(`Cannot use ozw configuration because ${envPath} is not a regular file.`);
    }
    return { exists: true, contents: await fs.readFile(envPath, 'utf8') };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return { exists: false, contents: '' };
    throw error;
  }
}

/**
 * PURPOSE: Create the dedicated state directory safely without changing permissions on an arbitrary custom path.
 */
async function ensureRuntimeHome(paths: RuntimeUserPaths, options: RuntimeUserStateOptions): Promise<void> {
  const env = options.env ?? process.env;
  let existingStats;
  try {
    existingStats = await fs.lstat(paths.homePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') throw error;
    await fs.mkdir(paths.homePath, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await fs.chmod(paths.homePath, 0o700);
    return;
  }

  if (existingStats.isSymbolicLink() || !existingStats.isDirectory()) {
    throw new RuntimeUserStateError(`Cannot use ozw state path because ${paths.homePath} is not a regular directory.`);
  }
  if (process.platform === 'win32') return;

  const permissions = existingStats.mode & 0o777;
  if (env.OZW_HOME?.trim() && (permissions & 0o077) !== 0) {
    throw new RuntimeUserStateError(
      `Custom OZW_HOME must be private: ${paths.homePath} has mode ${permissions.toString(8)}; run chmod 700 on it first.`,
    );
  }
  if (!env.OZW_HOME?.trim() && permissions !== 0o700) {
    await fs.chmod(paths.homePath, 0o700);
  }
}

/**
 * PURPOSE: Atomically publish a complete configuration file without replacing a concurrent winner.
 */
async function createEnvFileAtomically(envPath: string, contents: string): Promise<boolean> {
  const temporaryPath = `${envPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    try {
      await fs.link(temporaryPath, envPath);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw error;
      return false;
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

/**
 * PURPOSE: Copy the former installation-root configuration into user state once without overwriting a newer file.
 */
async function migrateLegacyEnvFile(envPath: string, legacyEnvPath?: string): Promise<void> {
  if (!legacyEnvPath) return;
  const sourcePath = path.resolve(legacyEnvPath);
  if (sourcePath === path.resolve(envPath)) return;

  try {
    await fs.lstat(envPath);
    return;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') throw error;
  }

  let sourceStats;
  try {
    sourceStats = await fs.lstat(sourcePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return;
    throw error;
  }
  if (!sourceStats.isFile()) {
    throw new RuntimeUserStateError(`Cannot migrate legacy ozw configuration because ${sourcePath} is not a regular file.`);
  }

  const contents = await fs.readFile(sourcePath, 'utf8');
  await createEnvFileAtomically(envPath, contents);
}

/**
 * PURPOSE: Replace an existing configuration atomically after preserving its unrelated values.
 */
async function replaceEnvFileAtomically(envPath: string, contents: string): Promise<void> {
  const temporaryPath = `${envPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    await fs.rename(temporaryPath, envPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

/**
 * PURPOSE: Append one complete credential record so contenders on an existing file agree on its first token.
 */
async function appendAndConvergeAccessToken(envPath: string, previousContents: string): Promise<PublishedAccessToken> {
  const candidate = generateAccessToken();
  const prefix = previousContents.length > 0 && !previousContents.endsWith('\n') ? '\n' : '';
  await fs.appendFile(envPath, `${prefix}OZW_ACCESS_TOKEN=${candidate}\n`, { encoding: 'utf8', mode: 0o600 });

  const current = await secureExistingEnvFile(envPath);
  const persistedToken = findFirstConfiguredAccessToken(current.contents);
  if (!persistedToken) {
    throw new RuntimeUserStateError(`Missing OZW_ACCESS_TOKEN after atomically extending ${envPath}.`);
  }
  const token = validateAccessToken(persistedToken, envPath);
  const normalized = setEnvFileValue(current.contents, 'OZW_ACCESS_TOKEN', token);
  if (normalized !== current.contents) await replaceEnvFileAtomically(envPath, normalized);
  return { token, published: token === candidate };
}

/**
 * PURPOSE: Remove the retired bootstrap seed after .env is authoritative without following an unsafe path.
 */
async function removeObsoleteAccessTokenSeed(homePath: string): Promise<void> {
  const seedPath = path.join(homePath, ACCESS_TOKEN_SEED_FILE_NAME);
  try {
    await fs.unlink(seedPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') throw error;
  }
}

/**
 * PURPOSE: Create or validate the private user configuration and apply its effective runtime values.
 */
export async function initializeRuntimeUserState(
  options: RuntimeUserStateOptions = {},
): Promise<RuntimeUserState> {
  const env = options.env ?? process.env;
  const paths = resolveRuntimeUserPaths(options);
  await ensureRuntimeHome(paths, options);
  await migrateLegacyEnvFile(paths.envPath, options.legacyEnvPath);
  let envFile = await secureExistingEnvFile(paths.envPath);
  let fileValues = parseEnvFile(envFile.contents);
  const persistedToken = fileValues.get('OZW_ACCESS_TOKEN');
  const explicitToken = env.OZW_ACCESS_TOKEN || undefined;
  const effectiveExplicitToken = explicitToken === undefined
    ? undefined
    : validateAccessToken(explicitToken, 'the process environment');
  const effectivePersistedToken = effectiveExplicitToken === undefined && persistedToken
    ? validateAccessToken(persistedToken, paths.envPath)
    : undefined;
  let accessTokenGenerated = false;
  let accessToken = effectiveExplicitToken ?? effectivePersistedToken;

  if (!accessToken) {
    if (!envFile.exists) {
      const candidate = generateAccessToken();
      const contents = setEnvFileValue('', 'OZW_ACCESS_TOKEN', candidate);
      const created = await createEnvFileAtomically(paths.envPath, contents);
      if (created) {
        accessToken = candidate;
        accessTokenGenerated = true;
      } else {
        envFile = await secureExistingEnvFile(paths.envPath);
        const concurrentToken = parseEnvFile(envFile.contents).get('OZW_ACCESS_TOKEN');
        if (concurrentToken === undefined) {
          const publishedToken = await appendAndConvergeAccessToken(paths.envPath, envFile.contents);
          accessToken = publishedToken.token;
          accessTokenGenerated = publishedToken.published;
        } else {
          accessToken = validateAccessToken(concurrentToken, paths.envPath);
        }
      }
    } else {
      const publishedToken = await appendAndConvergeAccessToken(paths.envPath, envFile.contents);
      accessToken = publishedToken.token;
      accessTokenGenerated = publishedToken.published;
    }
    envFile = await secureExistingEnvFile(paths.envPath);
    fileValues = parseEnvFile(envFile.contents);
  } else if (!envFile.exists) {
    await createEnvFileAtomically(paths.envPath, '');
    envFile = await secureExistingEnvFile(paths.envPath);
    fileValues = parseEnvFile(envFile.contents);
  }

  await removeObsoleteAccessTokenSeed(paths.homePath);

  if (process.platform !== 'win32') await fs.chmod(paths.envPath, 0o600);
  for (const [key, value] of fileValues) {
    if (key === 'OZW_HOME') continue;
    if (env[key] === undefined) env[key] = value;
  }
  env.OZW_ACCESS_TOKEN = accessToken;
  if (!env.DATABASE_PATH?.trim()) {
    env.DATABASE_PATH = paths.databasePath;
    env.OZW_DATABASE_PATH_DEFAULTED = 'true';
  }
  if (!env.OZW_JWT_SECRET_PATH?.trim()) {
    env.OZW_JWT_SECRET_PATH = paths.jwtSecretPath;
  }
  const jwtSecretPath = resolveJwtSecretPath(env);
  getJwtSecret(env);

  return {
    ...paths,
    databasePath: env.DATABASE_PATH,
    jwtSecretPath,
    accessToken,
    accessTokenGenerated,
  };
}

/**
 * PURPOSE: Read effective user configuration for status output without creating files or consuming first-run secrets.
 */
export async function inspectRuntimeUserState(
  options: RuntimeUserStateOptions = {},
): Promise<RuntimeUserStateInspection> {
  const env = options.env ?? process.env;
  const paths = resolveRuntimeUserPaths(options);
  const envFile = await inspectExistingEnvFile(paths.envPath);
  const fileValues = parseEnvFile(envFile.contents);
  const effectiveEnv: NodeJS.ProcessEnv = Object.fromEntries(fileValues);
  Object.assign(effectiveEnv, env);
  const configuredToken = effectiveEnv.OZW_ACCESS_TOKEN ?? '';

  return {
    ...paths,
    envExists: envFile.exists,
    databasePath: effectiveEnv.DATABASE_PATH?.trim() || paths.databasePath,
    accessTokenConfigured: configuredToken.length > 0,
    accessTokenValid: configuredToken.length > 0 && Array.from(configuredToken).length === ACCESS_TOKEN_LENGTH,
    effectiveEnv,
  };
}
