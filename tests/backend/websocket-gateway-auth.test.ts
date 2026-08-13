/**
 * PURPOSE: Prove WebSocket upgrades require a valid bearer token in every deployment mode.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const originalEnv = {
  HOME: process.env.HOME,
  DATABASE_PATH: process.env.DATABASE_PATH,
  VITE_IS_PLATFORM: process.env.VITE_IS_PLATFORM,
};
const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-websocket-gateway-auth-'));
process.env.HOME = tempHome;
process.env.DATABASE_PATH = path.join(tempHome, 'auth.db');
process.env.VITE_IS_PLATFORM = 'true';

const [{ initializeDatabase, userDb }, { generateToken }, { authenticateWebSocketUpgrade }] = await Promise.all([
  import('../../backend/database/db.ts'),
  import('../../backend/middleware/auth.ts'),
  import('../../backend/server/websocket-gateway.ts'),
]);
await initializeDatabase();

test.after(async () => {
  /** Restore environment state and delete the isolated authentication database. */
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});

test('every mode rejects WebSocket upgrades with a missing or invalid token', () => {
  /** Keep deployment flags from creating an implicit WebSocket identity. */
  for (const platformMode of ['false', 'true']) {
    process.env.VITE_IS_PLATFORM = platformMode;
    assert.equal(authenticateWebSocketUpgrade({ headers: {} } as never), null);
    assert.equal(authenticateWebSocketUpgrade({ headers: { authorization: 'Bearer invalid' } } as never), null);
  }
});

test('every mode accepts WebSocket upgrades with an existing valid JWT', () => {
  /** Preserve authenticated WebSocket access while enforcing the token boundary. */
  const user = userDb.getSingleUser();
  const token = generateToken(user);
  for (const platformMode of ['false', 'true']) {
    process.env.VITE_IS_PLATFORM = platformMode;
    assert.deepEqual(
      authenticateWebSocketUpgrade({ headers: { authorization: `Bearer ${token}` } } as never),
      { userId: user.id, username: 'ozw' },
    );
  }
});
