/**
 * 文件目的：验证固定访问令牌登录、配置失败、内部 JWT 和 localhost 不绕过认证的安全边界。
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

const ACCESS_TOKEN = '0123456789abcdef0123456789abcdef';
const originalEnv = {
  HOME: process.env.HOME,
  DATABASE_PATH: process.env.DATABASE_PATH,
  OZW_ACCESS_TOKEN: process.env.OZW_ACCESS_TOKEN,
};
const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-access-token-auth-'));
process.env.HOME = tempHome;
process.env.DATABASE_PATH = path.join(tempHome, 'ozw.db');
process.env.OZW_ACCESS_TOKEN = ACCESS_TOKEN;

const [{ default: authRouter }, { authenticateToken }, { initializeDatabase, userDb }, accessTokenModule] = await Promise.all([
  import('../../backend/routes/auth.ts'),
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
  import('../../backend/security/access-token.ts'),
]);
await initializeDatabase();

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.get('/api/protected', authenticateToken, (req, res) => res.json({ user: req.user }));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('test server did not expose a TCP address');
}
const baseUrl = `http://127.0.0.1:${address.port}`;

test.after(async () => {
  /**
   * PURPOSE: Restore process configuration and remove the isolated authentication database.
   */
  server.close();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});

test('fresh database creates one internal identity without registration', async () => {
  /**
   * PURPOSE: Keep legacy user_id ownership internal and remove the public account-creation path.
   */
  const user = userDb.getSingleUser();
  assert.equal(user.username, 'ozw');
  assert.equal(userDb.getFirstUser()?.id, user.id);

  const registration = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST' });
  assert.equal(registration.status, 404);
});

test('status reports access-token configuration and localhost does not bypass login', async () => {
  /**
   * PURPOSE: Require the same token login on loopback and public deployments.
   */
  const status = await fetch(`${baseUrl}/api/auth/status`, { headers: { Host: `localhost:${address.port}` } });
  assert.deepEqual(await status.json(), {
    isAuthenticated: false,
    accessTokenConfigured: true,
    error: null,
  });

  const protectedResponse = await fetch(`${baseUrl}/api/protected`, { headers: { Host: `localhost:${address.port}` } });
  assert.equal(protectedResponse.status, 401);
});

test('missing or malformed deployment token rejects login clearly', async () => {
  /**
   * PURPOSE: Surface deployment errors without falling back to an account or localhost identity.
   */
  delete process.env.OZW_ACCESS_TOKEN;
  const missingResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: ACCESS_TOKEN }),
  });
  assert.equal(missingResponse.status, 503);
  assert.match((await missingResponse.json()).error, /OZW_ACCESS_TOKEN is not configured/);

  process.env.OZW_ACCESS_TOKEN = 'too-short';
  const malformedResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: ACCESS_TOKEN }),
  });
  assert.equal(malformedResponse.status, 503);
  assert.match((await malformedResponse.json()).error, /exactly 32 characters/);
  process.env.OZW_ACCESS_TOKEN = ACCESS_TOKEN;
});

test('exact 32-character token creates an internal JWT session', async () => {
  /**
   * PURPOSE: Reject malformed and incorrect tokens, then authorize with the configured token only.
   */
  assert.equal(accessTokenModule.verifyAccessToken(ACCESS_TOKEN), true);
  assert.equal(accessTokenModule.verifyAccessToken('ffffffffffffffffffffffffffffffff'), false);

  const invalidLength = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: 'short' }),
  });
  assert.equal(invalidLength.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: ACCESS_TOKEN }),
  });
  assert.equal(login.status, 200);
  const payload = await login.json();
  assert.equal(payload.user.username, 'ozw');
  assert.equal(typeof payload.token, 'string');

  const protectedResponse = await fetch(`${baseUrl}/api/protected`, {
    headers: { authorization: `Bearer ${payload.token}` },
  });
  assert.equal(protectedResponse.status, 200);
  assert.equal((await protectedResponse.json()).user.username, 'ozw');
});
