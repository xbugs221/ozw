/**
 * PURPOSE: Verify that JWT signing secrets are generated securely, migrated from
 * legacy database-adjacent storage, and retained across restarts and relocation.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getJwtSecret,
  resetJwtSecretCacheForTest,
  resolveJwtSecretPath,
} from '../../backend/security/jwt-secret.ts';

test('JWT secret is generated once and survives a simulated process restart', async () => {
  /** Business case: existing browser sessions remain valid after ozw restarts. */
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-jwt-secret-'));
  const env: NodeJS.ProcessEnv = {
    OZW_HOME: tempDirectory,
    DATABASE_PATH: path.join(tempDirectory, 'auth.db'),
  };

  try {
    const firstSecret = getJwtSecret(env);
    resetJwtSecretCacheForTest();
    const restartedSecret = getJwtSecret(env);
    const secretStats = await fs.stat(resolveJwtSecretPath(env));

    assert.equal(firstSecret, restartedSecret);
    assert.equal(Buffer.from(firstSecret, 'base64url').length, 32);
    if (process.platform !== 'win32') {
      assert.equal(secretStats.mode & 0o777, 0o600);
    }
  } finally {
    resetJwtSecretCacheForTest();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

test('JWT secret stays stable when the database moves and differs across runtime homes', async () => {
  /** Business case: upgrades and database relocation preserve sessions within one user environment. */
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-jwt-isolation-'));
  const firstHome = path.join(tempDirectory, 'first-home');
  const secondHome = path.join(tempDirectory, 'second-home');
  const firstEnv = { OZW_HOME: firstHome, DATABASE_PATH: path.join(tempDirectory, 'first.db') };
  const movedDatabaseEnv = { OZW_HOME: firstHome, DATABASE_PATH: path.join(tempDirectory, 'moved.db') };
  const secondEnv = { OZW_HOME: secondHome, DATABASE_PATH: path.join(tempDirectory, 'second.db') };

  try {
    const firstSecret = getJwtSecret(firstEnv);
    resetJwtSecretCacheForTest();
    const movedDatabaseSecret = getJwtSecret(movedDatabaseEnv);
    resetJwtSecretCacheForTest();
    const secondSecret = getJwtSecret(secondEnv);
    assert.equal(firstSecret, movedDatabaseSecret);
    assert.notEqual(firstSecret, secondSecret);
  } finally {
    resetJwtSecretCacheForTest();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

test('legacy database-adjacent JWT secret migrates once without overwriting new user state', async () => {
  /** Business case: package upgrades preserve sessions, while an existing new secret always wins. */
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-jwt-migration-'));
  const runtimeHome = path.join(tempDirectory, 'runtime-home');
  const databasePath = path.join(tempDirectory, 'legacy.db');
  const movedDatabasePath = path.join(tempDirectory, 'moved.db');
  const legacySecretPath = `${databasePath}.jwt-secret`;
  const legacySecret = crypto.randomBytes(32).toString('base64url');
  const replacementLegacySecret = crypto.randomBytes(32).toString('base64url');
  const env = { OZW_HOME: runtimeHome, DATABASE_PATH: databasePath };

  try {
    await fs.writeFile(legacySecretPath, legacySecret, { mode: 0o644 });
    const migratedSecret = getJwtSecret(env);
    const stableSecretPath = resolveJwtSecretPath(env);

    assert.equal(migratedSecret, legacySecret);
    assert.equal((await fs.readFile(stableSecretPath, 'utf8')).trim(), legacySecret);
    assert.equal((await fs.readFile(legacySecretPath, 'utf8')).trim(), legacySecret);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(stableSecretPath)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(legacySecretPath)).mode & 0o777, 0o600);
    }

    await fs.writeFile(legacySecretPath, replacementLegacySecret, { mode: 0o600 });
    resetJwtSecretCacheForTest();
    assert.equal(getJwtSecret(env), legacySecret);

    resetJwtSecretCacheForTest();
    assert.equal(getJwtSecret({ OZW_HOME: runtimeHome, DATABASE_PATH: movedDatabasePath }), legacySecret);
  } finally {
    resetJwtSecretCacheForTest();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

test('invalid persisted JWT secrets fail closed without being overwritten', async () => {
  /** Business case: corrupt or weak state must surface a repair action rather than rotate sessions silently. */
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-jwt-invalid-'));
  const secretPath = path.join(tempDirectory, '.jwt-secret');
  const env = { OZW_HOME: tempDirectory };
  const invalidSecrets = [
    '',
    Buffer.alloc(32).toString('base64url'),
    Buffer.from('password'.repeat(4), 'utf8').toString('base64url'),
    crypto.randomBytes(31).toString('base64url'),
    `${crypto.randomBytes(32).toString('base64url')}=`,
    '!'.repeat(43),
  ];

  try {
    for (const invalidSecret of invalidSecrets) {
      await fs.writeFile(secretPath, invalidSecret, { mode: 0o600 });
      resetJwtSecretCacheForTest();
      assert.throws(
        () => getJwtSecret(env),
        (error: unknown) => error instanceof Error
          && error.message.includes(secretPath)
          && /expected canonical unpadded base64url for 32 random bytes/u.test(error.message)
          && /Restore the original secret/u.test(error.message),
      );
      assert.equal(await fs.readFile(secretPath, 'utf8'), invalidSecret);
    }
  } finally {
    resetJwtSecretCacheForTest();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

test('invalid legacy JWT secret blocks migration without creating replacement state', async () => {
  /** Business case: an upgrade must not hide legacy credential corruption behind a new secret. */
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-jwt-invalid-legacy-'));
  const runtimeHome = path.join(tempDirectory, 'runtime-home');
  const databasePath = path.join(tempDirectory, 'legacy.db');
  const legacySecretPath = `${databasePath}.jwt-secret`;
  const env = { OZW_HOME: runtimeHome, DATABASE_PATH: databasePath };

  try {
    await fs.writeFile(legacySecretPath, 'truncated', { mode: 0o600 });
    assert.throws(() => getJwtSecret(env), /Invalid JWT secret.*Restore the original secret/u);
    await assert.rejects(fs.stat(resolveJwtSecretPath(env)), { code: 'ENOENT' });
    assert.equal(await fs.readFile(legacySecretPath, 'utf8'), 'truncated');
  } finally {
    resetJwtSecretCacheForTest();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});
