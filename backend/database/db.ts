/**
 * 文件目的：初始化 ozw 的 SQLite 数据库，并提供用户、API 密钥和 provider 凭据的数据访问接口。
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { resolvePackageRoot } from '../utils/package-root.js';

const PKG_ROOT = resolvePackageRoot();
const __dirname = path.join(PKG_ROOT, 'backend', 'database');

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const c = {
    info: (text: string): string => `${colors.cyan}${text}${colors.reset}`,
    bright: (text: string): string => `${colors.bright}${text}${colors.reset}`,
  dim: (text: string): string => `${colors.dim}${text}${colors.reset}`,
};

const API_KEY_PREFIX_LENGTH = 8;
const SINGLE_USER_NAME = 'ozw';
const DISABLED_PASSWORD_HASH = '!';
// Increment together with every init.sql schema change; the contract test pins both.
const CURRENT_DATABASE_SCHEMA_VERSION = 1;

// Use DATABASE_PATH environment variable if set, otherwise use default location
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'ozw.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');
const DATABASE_PATH_DEFAULTED_BY_LOAD_ENV = process.env.OZW_DATABASE_PATH_DEFAULTED === 'true';

// Ensure database directory exists if custom path is provided
if (process.env.DATABASE_PATH) {
  const dbDir = path.dirname(DB_PATH);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Failed to create database directory ${dbDir}:`, err.message);
    throw error;
  }
}

// Move default installs from the legacy auth.db name/location to ozw.db.
const LEGACY_INSTALL_DB_PATH = path.join(__dirname, 'auth.db');
const LEGACY_HOME_DB_PATH = path.join(path.dirname(DB_PATH), 'auth.db');
const legacyDbPath = fs.existsSync(LEGACY_HOME_DB_PATH) ? LEGACY_HOME_DB_PATH : LEGACY_INSTALL_DB_PATH;
if (DATABASE_PATH_DEFAULTED_BY_LOAD_ENV && DB_PATH !== legacyDbPath && !fs.existsSync(DB_PATH) && fs.existsSync(legacyDbPath)) {
  try {
    fs.copyFileSync(legacyDbPath, DB_PATH);
    console.log(`[MIGRATION] Copied database from ${legacyDbPath} to ${DB_PATH}`);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(legacyDbPath + suffix)) {
        fs.copyFileSync(legacyDbPath + suffix, DB_PATH + suffix);
      }
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.warn(`[MIGRATION] Could not copy legacy database: ${e.message}`);
  }
}

// Create database connection
const db = new Database(DB_PATH);

/**
 * PURPOSE: Keep many small index updates responsive on low-end local disks
 * while retaining crash consistency and bounded lock recovery.
 */
const configureDatabaseConnection = (): void => {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    const journalMode = String(db.pragma('journal_mode = WAL', { simple: true }) || '').toLowerCase();
    if (journalMode === 'wal') {
      db.pragma('synchronous = NORMAL');
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.warn(`[Database] WAL mode unavailable; retaining SQLite defaults: ${err.message}`);
  }
};

configureDatabaseConnection();

// Show app installation path prominently
console.log('');
console.log(c.dim('═'.repeat(60)));
console.log(`${c.info('[INFO]')} App Installation: ${c.bright(PKG_ROOT)}`);
console.log(`${c.info('[INFO]')} Database: ${c.dim(path.relative(PKG_ROOT, DB_PATH))}`);
if (process.env.DATABASE_PATH) {
  console.log(`       ${c.dim('(Using custom DATABASE_PATH from environment)')}`);
}
console.log(c.dim('═'.repeat(60)));
console.log('');

interface ColumnInfo {
  name: string;
  [key: string]: unknown;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  last_login: string | null;
  is_active: number;
  git_name?: string | null;
  git_email?: string | null;
  has_completed_onboarding?: number;
}

/**
 * PURPOSE: Return whether a sqlite table contains a specific column.
 */
const hasTableColumn = (tableName: string, columnName: string): boolean => {
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return tableInfo.some((column) => column.name === columnName);
};

/**
 * PURPOSE: Hash API keys before persistence for secure storage.
 */
const hashApiKey = (apiKey: string): string => {
  return crypto.createHash('sha256').update(String(apiKey)).digest('hex');
};

/**
 * PURPOSE: Keep a short api-key prefix for efficient lookup.
 */
const apiKeyPrefix = (apiKey: string): string => {
  return String(apiKey || '').slice(0, API_KEY_PREFIX_LENGTH);
};

/**
 * PURPOSE: Quickly detect legacy plaintext API keys.
 */
const isLegacyApiKeyValue = (storedValue: unknown): boolean => {
  if (typeof storedValue !== 'string') {
    return false;
  }

  if (!storedValue) {
    return false;
  }

  if (storedValue.length === 64 && /^[0-9a-f]{64}$/i.test(storedValue)) {
    return false;
  }

  if (storedValue.startsWith('ck_') && storedValue.length === 66) {
    return true;
  }

  return true;
};

/**
 * PURPOSE: Detect legacy encrypted provider credentials that ozw can no longer decode.
 */
const isUnreadableLegacyCredential = (storedValue: string): boolean => {
  const [ivHex = '', authTagHex = '', payloadHex = '', extraPart] = String(storedValue).split(':');
  return (
    extraPart === undefined &&
    ivHex.length === 24 &&
    authTagHex.length === 32 &&
    payloadHex.length > 0 &&
    /^[0-9a-f]+$/i.test(ivHex) &&
    /^[0-9a-f]+$/i.test(authTagHex) &&
    /^[0-9a-f]+$/i.test(payloadHex)
  );
};

/**
 * PURPOSE: Re-hash legacy plaintext API keys.
 */
const migrateLegacyApiKeys = (): void => {
  if (!hasTableColumn('api_keys', 'api_key_prefix')) {
    return;
  }

  const rows = db.prepare('SELECT id, api_key FROM api_keys WHERE is_active = 1').all() as Array<{ id: number; api_key: string }>;
  const updateStmt = db.prepare('UPDATE api_keys SET api_key = ?, api_key_prefix = ? WHERE id = ?');

  for (const row of rows) {
    if (!isLegacyApiKeyValue(row.api_key)) {
      continue;
    }

    const hashed = hashApiKey(row.api_key);
    updateStmt.run(hashed, apiKeyPrefix(row.api_key), row.id);
  }
};

const runMigrations = (): void => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all() as ColumnInfo[];
    const columnNames = tableInfo.map((col: ColumnInfo) => col.name);

    if (!columnNames.includes('git_name')) {
      console.log('Running migration: Adding git_name column');
      db.exec('ALTER TABLE users ADD COLUMN git_name TEXT');
    }

    if (!columnNames.includes('git_email')) {
      console.log('Running migration: Adding git_email column');
      db.exec('ALTER TABLE users ADD COLUMN git_email TEXT');
    }

    if (!columnNames.includes('has_completed_onboarding')) {
      console.log('Running migration: Adding has_completed_onboarding column');
      db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 0');
    }

    if (!hasTableColumn('api_keys', 'api_key_prefix')) {
      console.log('Running migration: Adding api_key_prefix column');
      db.exec('ALTER TABLE api_keys ADD COLUMN api_key_prefix TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(api_key_prefix)');
    }

    migrateLegacyApiKeys();

    console.log('Database migrations completed successfully');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Error running migrations:', err.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async (): Promise<void> => {
  try {
    const schemaVersion = Number(db.pragma('user_version', { simple: true }) || 0);
    if (schemaVersion < CURRENT_DATABASE_SCHEMA_VERSION) {
      const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
      db.exec(initSQL);
      console.log('Database initialized successfully');
      runMigrations();
      db.pragma(`user_version = ${CURRENT_DATABASE_SCHEMA_VERSION}`);
    }
    userDb.getSingleUser();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Error initializing database:', err.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Update last login time (non-fatal — logged but not thrown)
  updateLastLogin: (userId: number): void => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn('Failed to update last login:', e.message);
    }
  },

  // Get user by ID
  getUserById: (userId: number): Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'> | undefined => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE id = ? AND is_active = 1').get(userId) as Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'> | undefined;
      return row;
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: (): Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'> | undefined => {
    /**
     * PURPOSE: Preserve internal data/test compatibility while public authentication uses getSingleUser.
     */
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1').get() as Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'> | undefined;
      return row;
    } catch (err) {
      throw err;
    }
  },

  getSingleUser: (): Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'> => {
    /**
     * PURPOSE: Reuse the legacy active row as the internal single-user identity,
     * or create one automatically when a fresh database has no user row.
     */
    const existing = db.prepare('SELECT id, created_at, last_login FROM users WHERE is_active = 1 ORDER BY id LIMIT 1')
      .get() as Pick<UserRow, 'id' | 'created_at' | 'last_login'> | undefined;
    if (existing) {
      return { ...existing, username: SINGLE_USER_NAME };
    }

    db.prepare(`
      INSERT INTO users (username, password_hash, is_active)
      VALUES (?, ?, 1)
      ON CONFLICT(username) DO UPDATE SET is_active = 1
    `).run(SINGLE_USER_NAME, DISABLED_PASSWORD_HASH);
    const userId = (db.prepare('SELECT id FROM users WHERE username = ?').get(SINGLE_USER_NAME) as { id: number }).id;
    const created = db.prepare('SELECT id, created_at, last_login FROM users WHERE id = ?').get(userId) as Pick<UserRow, 'id' | 'created_at' | 'last_login'>;
    return { ...created, username: SINGLE_USER_NAME };
  },

  updateGitConfig: (userId: number, gitName: string, gitEmail: string): void => {
    try {
      const stmt = db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?');
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId: number): Pick<UserRow, 'git_name' | 'git_email'> | undefined => {
    try {
      const row = db.prepare('SELECT git_name, git_email FROM users WHERE id = ?').get(userId) as Pick<UserRow, 'git_name' | 'git_email'> | undefined;
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId: number): void => {
    try {
      const stmt = db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?');
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId: number): boolean => {
    try {
      const row = db.prepare('SELECT has_completed_onboarding FROM users WHERE id = ?').get(userId) as { has_completed_onboarding: number } | undefined;
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  }
};

interface ApiKeyRecord {
  id: number;
  keyName: string;
  apiKey: string;
}

interface ApiKeyRow {
  id: number;
  key_name: string;
  api_key: string;
  created_at: string;
  last_used: string | null;
  is_active: number;
}

interface ApiKeyValidateRow {
  id: number;
  username: string;
  api_key_id: number;
  api_key: string;
  api_key_prefix: string | null;
}

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: (): string => {
    return 'ck_' + crypto.randomBytes(32).toString('hex');
  },

  // Create a new API key
  createApiKey: (userId: number, keyName: string): ApiKeyRecord => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const hashedApiKey = hashApiKey(apiKey);
      const prefix = apiKeyPrefix(apiKey);
      const hasPrefixColumn = hasTableColumn('api_keys', 'api_key_prefix');
      const stmt = hasPrefixColumn
        ? db.prepare('INSERT INTO api_keys (user_id, key_name, api_key, api_key_prefix) VALUES (?, ?, ?, ?)')
        : db.prepare('INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)');

      const result = hasPrefixColumn
        ? stmt.run(userId, keyName, hashedApiKey, prefix)
        : stmt.run(userId, keyName, hashedApiKey);
      return { id: Number(result.lastInsertRowid), keyName, apiKey };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user
  getApiKeys: (userId: number): ApiKeyRow[] => {
    try {
      const rows = db.prepare('SELECT id, key_name, api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) as ApiKeyRow[];
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user
  validateApiKey: (apiKey: string): ApiKeyValidateRow | undefined => {
    try {
      const requestedHash = hashApiKey(apiKey);
      const prefix = apiKeyPrefix(apiKey);
      const hasPrefixColumn = hasTableColumn('api_keys', 'api_key_prefix');
      let row: ApiKeyValidateRow | undefined;

      if (hasPrefixColumn) {
        row = db.prepare(`
          SELECT u.id, u.username, ak.id as api_key_id, ak.api_key, ak.api_key_prefix
          FROM api_keys ak
          JOIN users u ON ak.user_id = u.id
          WHERE ak.api_key_prefix = ? AND ak.is_active = 1 AND u.is_active = 1
        `).get(prefix) as ApiKeyValidateRow | undefined;

        if (row && row.api_key !== requestedHash) {
          row = undefined;
        }
      }

      if (!row) {
        const rows = db.prepare(`
          SELECT u.id, u.username, ak.id as api_key_id, ak.api_key, ak.api_key_prefix
          FROM api_keys ak
          JOIN users u ON ak.user_id = u.id
          WHERE ak.is_active = 1 AND u.is_active = 1
        `).all() as ApiKeyValidateRow[];
        row = rows.find((candidate) => candidate.api_key === requestedHash);
      }

      if (row) {
        // Update last_used timestamp
        db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.api_key_id);

        if (hasPrefixColumn && isLegacyApiKeyValue(row.api_key)) {
          db.prepare('UPDATE api_keys SET api_key = ?, api_key_prefix = ? WHERE id = ?')
            .run(requestedHash, prefix, row.api_key_id);
        }
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId: number, apiKeyId: number): boolean => {
    try {
      const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId: number, apiKeyId: number, isActive: boolean): boolean => {
    try {
      const stmt = db.prepare('UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

interface CredentialRow {
  id: number;
  credential_name: string;
  credential_type: string;
  description: string | null;
  created_at: string;
  is_active: number;
}

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId: number, credentialType: string | null = null): CredentialRow[] => {
    try {
      let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
      const params: (number | string)[] = [userId];

      if (credentialType) {
        query += ' AND credential_type = ?';
        params.push(credentialType);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params) as CredentialRow[];
      return rows;
    } catch (err) {
      throw err;
    }
  },

  /**
   * PURPOSE: Return the most recently saved active credential for a user and provider type.
   */
  getActiveCredential: (userId: number, credentialType: string): string | null => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1')
        .get(userId, credentialType) as { credential_value: string } | undefined;
      if (!row || isUnreadableLegacyCredential(row.credential_value)) {
        return null;
      }
      return row.credential_value;
    } catch (err) {
      throw err;
    }
  },

  /**
   * PURPOSE: Return a specific active credential when it belongs to the requested user and provider type.
   */
  getCredentialById: (userId: number, credentialId: number, credentialType: string): string | null => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE id = ? AND user_id = ? AND credential_type = ? AND is_active = 1')
        .get(credentialId, userId, credentialType) as { credential_value: string } | undefined;
      if (!row || isUnreadableLegacyCredential(row.credential_value)) {
        return null;
      }
      return row.credential_value;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId: number, credentialId: number): boolean => {
    try {
      const stmt = db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?');
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId: number, credentialId: number, isActive: boolean): boolean => {
    try {
      const stmt = db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  getGithubTokens: (userId: number) => {
    return credentialsDb.getCredentials(userId, 'github_token');
  },
  getActiveGithubToken: (userId: number) => {
    return credentialsDb.getActiveCredential(userId, 'github_token');
  },
  getGithubTokenById: (userId: number, tokenId: number) => {
    return credentialsDb.getCredentialById(userId, tokenId, 'github_token');
  },
  deleteGithubToken: (userId: number, tokenId: number) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId: number, tokenId: number, isActive: boolean) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  }
};

const __databaseInternalsForTest = {
  hashApiKey,
  apiKeyPrefix,
  hasTableColumn,
};

export {
  db,
  initializeDatabase,
  userDb,
  apiKeysDb,
  credentialsDb,
  githubTokensDb, // Backward compatibility
  __databaseInternalsForTest,
};
