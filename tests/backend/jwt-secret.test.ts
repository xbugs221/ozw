/**
 * PURPOSE: Verify that JWT signing secrets are generated securely, isolated by
 * database, and retained across backend process restarts without configuration.
 */
import assert from 'node:assert/strict';
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

test('different database instances receive different JWT secrets', async () => {
  /** Business case: isolated deployments cannot use each other's login tokens. */
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-jwt-isolation-'));
  const firstEnv = { DATABASE_PATH: path.join(tempDirectory, 'first.db') };
  const secondEnv = { DATABASE_PATH: path.join(tempDirectory, 'second.db') };

  try {
    const firstSecret = getJwtSecret(firstEnv);
    const secondSecret = getJwtSecret(secondEnv);
    assert.notEqual(firstSecret, secondSecret);
  } finally {
    resetJwtSecretCacheForTest();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});
