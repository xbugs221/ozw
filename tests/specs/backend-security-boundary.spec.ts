/**
 * Sources: 2026-06-11-94-收敛后端安全债务
 *
 * 文件目的：稳定验证后端认证、工作区路径、Codex 权限、GitHub token 和凭据持久化的安全边界。
 * 业务场景：用户通过登录、Agent、Git clone、WebSocket/Shell 和 provider 凭据功能操作项目时，密钥不能通过默认值、URL、进程参数或明文数据库记录泄漏。
 */
/// <reference path="../../backend/types.d.ts" />
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import test from 'node:test';

const originalEnv = {
  HOME: process.env.HOME,
  DATABASE_PATH: process.env.DATABASE_PATH,
  WORKSPACES_ROOT: process.env.WORKSPACES_ROOT,
  CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
};

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-94-runtime-test-'));
const workspaceRoot = path.join(tempDir, 'workspace');
await fs.mkdir(workspaceRoot, { recursive: true });

process.env.HOME = tempDir;
process.env.WORKSPACES_ROOT = workspaceRoot;
process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
process.env.JWT_SECRET = 'runtime-security-test-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY = 'runtime-credential-test-key';
process.env.JWT_EXPIRES_IN = '2h';

const runtimeLogPath = path.join(process.cwd(), 'test-results/94-backend-security/runtime-log.json');

const {
  userDb,
  apiKeysDb,
  credentialsDb,
  githubTokensDb,
  db,
  initializeDatabase,
  __databaseInternalsForTest,
} = await import('../../backend/database/db.ts');
const {
  generateToken,
  __authInternalsForTest,
} = await import('../../backend/middleware/auth.ts');
const { validateWorkspacePath } = await import('../../backend/workspace-paths.ts');
const { sendCodexAppServerMessage } = await import('../../backend/codex-app-server-runtime.ts');
const { createGitCredentialEnvironment } = await import('../../backend/git-credential-env.ts');
const { getWebSocketAuthToken } = await import('../../backend/websocket-auth.ts');
const { __nativeAgentRuntimeInternalsForTest } = await import('../../backend/native-agent-runtime.ts');

await initializeDatabase();

const evidenceRows: Array<Record<string, unknown>> = [];

async function ensureLoggedInUser() {
  const existing = userDb.getFirstUser();
  if (existing) {
    return existing;
  }
  return userDb.createUser('runtime-security-user', '$2b$12$abcdefghijklmnopqrstuvxyz01234567890123456789');
}

function encryptCredentialWithLegacyKey(plaintext: string): string {
  /**
   * PURPOSE: Reproduce the pre-change AES key derivation so migration covers real stored ciphertext.
   */
  const legacyKey = crypto.createHash('sha256')
    .update(String(process.env.CREDENTIAL_ENCRYPTION_KEY))
    .digest('hex')
    .slice(0, 32);
  const initializationVector = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', legacyKey, initializationVector);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    initializationVector.toString('hex'),
    authTag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

test.after(async () => {
  if (originalEnv.HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalEnv.HOME;
  }

  if (originalEnv.DATABASE_PATH === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = originalEnv.DATABASE_PATH;
  }

  if (originalEnv.WORKSPACES_ROOT === undefined) {
    delete process.env.WORKSPACES_ROOT;
  } else {
    process.env.WORKSPACES_ROOT = originalEnv.WORKSPACES_ROOT;
  }

  if (originalEnv.JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalEnv.JWT_SECRET;
  }

  if (originalEnv.JWT_EXPIRES_IN === undefined) {
    delete process.env.JWT_EXPIRES_IN;
  } else {
    process.env.JWT_EXPIRES_IN = originalEnv.JWT_EXPIRES_IN;
  }

  if (originalEnv.CREDENTIAL_ENCRYPTION_KEY === undefined) {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  } else {
    process.env.CREDENTIAL_ENCRYPTION_KEY = originalEnv.CREDENTIAL_ENCRYPTION_KEY;
  }

  await fs.mkdir(path.dirname(runtimeLogPath), { recursive: true });
  await fs.writeFile(runtimeLogPath, JSON.stringify({ checks: evidenceRows }, null, 2), 'utf8');
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('JWT token must include expiration and fail when JWT_SECRET is absent', async () => {
  const user = await ensureLoggedInUser();
  const token = generateToken({ id: user.id, username: user.username });
  const claims = jwt.decode(token) as jwt.JwtPayload;
  assert.equal(typeof claims?.exp, 'number', 'Generated token should include exp');
  assert.equal(claims?.userId, user.id, 'Token claims should carry user id');

  process.env.JWT_SECRET = '';
  assert.throws(
    () => __authInternalsForTest.getJwtSecret(),
    /JWT_SECRET is not configured/,
    'JWT_SECRET missing should fail closed',
  );
  assert.equal(__authInternalsForTest.JWT_SECRET_MISSING_MESSAGE, 'JWT_SECRET is not configured');

  process.env.JWT_SECRET = 'runtime-security-test-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  assert.equal(__authInternalsForTest.getJwtExpiresIn(), '15m');
  process.env.JWT_EXPIRES_IN = '900';
  assert.equal(__authInternalsForTest.getJwtExpiresIn(), 900);
  process.env.JWT_EXPIRES_IN = 'invalid';
  assert.throws(
    () => __authInternalsForTest.getJwtExpiresIn(),
    /JWT_EXPIRES_IN is invalid/,
    'JWT_EXPIRES_IN malformed value should fail closed',
  );
  process.env.JWT_EXPIRES_IN = '';
  assert.throws(
    () => __authInternalsForTest.getJwtExpiresIn(),
    /JWT_EXPIRES_IN is invalid/,
    'JWT_EXPIRES_IN empty value should fail closed',
  );
  process.env.JWT_EXPIRES_IN = '2h';

  evidenceRows.push({
    id: 'jwt-expiration',
    passed: true,
    exp: claims.exp,
  });
});

test('Recoverable credential encryption fails closed without configured key', async () => {
  const childDatabasePath = path.join(tempDir, 'missing-credential-key-auth.db');
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_PATH: childDatabasePath,
    HOME: tempDir,
  };
  delete childEnv.CREDENTIAL_ENCRYPTION_KEY;

  const script = `
    import { __databaseInternalsForTest } from './backend/database/db.ts';
    try {
      __databaseInternalsForTest.normalizeCredentialKey();
      console.error('normalizeCredentialKey unexpectedly succeeded');
      process.exit(2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CREDENTIAL_ENCRYPTION_KEY is not configured/.test(message)) {
        process.exit(0);
      }
      console.error(message);
      process.exit(1);
    }
  `;

  const result = spawnSync('pnpm', ['exec', 'tsx', '--eval', script], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `missing credential key check failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(__databaseInternalsForTest.CREDENTIAL_KEY_MISSING_MESSAGE, 'CREDENTIAL_ENCRYPTION_KEY is not configured');

  evidenceRows.push({
    id: 'credential-key-required',
    passed: true,
  });
});

test('Agent projectPath must pass through workspace path validation before execution', async () => {
  const outsidePath = path.join(tempDir, 'outside');
  await fs.mkdir(outsidePath, { recursive: true });
  const outsidePathValidation = await validateWorkspacePath(outsidePath);
  assert.equal(outsidePathValidation.valid, false);
  assert.match(outsidePathValidation.error || '', /Workspace path must be within|Cannot create workspace in system directory/);

  const evilLink = path.join(workspaceRoot, 'evil');
  await fs.symlink('/etc', evilLink, 'dir');
  const evilValidation = await validateWorkspacePath(evilLink);
  assert.equal(evilValidation.valid, false);

  const varTmpSiblingValidation = await validateWorkspacePath('/var/tmp_malicious');
  assert.equal(varTmpSiblingValidation.valid, false);
  assert.match(varTmpSiblingValidation.error || '', /system directory|workspace/i);

  evidenceRows.push({
    id: 'agent-project-path',
    passed: true,
    deniedPaths: [outsidePath, evilLink, '/var/tmp_malicious'],
  });
});

test('API keys are stored as hash and validated by token comparison', async () => {
  const user = await ensureLoggedInUser();
  const created = apiKeysDb.createApiKey(user.id, 'runtime-key');
  const dbRow = db.prepare('SELECT api_key, api_key_prefix FROM api_keys WHERE id = ?').get(created.id) as { api_key: string; api_key_prefix: string | null };

  assert.equal(typeof dbRow.api_key, 'string');
  assert.notEqual(dbRow.api_key, created.apiKey, 'API key should not be stored as plain text');
  assert.equal(dbRow.api_key, __databaseInternalsForTest.hashApiKey(created.apiKey), 'API key should be stored as sha-256 hash');
  assert.equal(dbRow.api_key.length, 64, 'SHA-256 hash length should be 64');
  if (dbRow.api_key_prefix) {
    assert.equal(dbRow.api_key_prefix, __databaseInternalsForTest.apiKeyPrefix(created.apiKey));
  }

  const validated = apiKeysDb.validateApiKey(created.apiKey);
  assert.equal(validated?.id, user.id);

  const invalid = apiKeysDb.validateApiKey('invalid-key');
  assert.equal(invalid, undefined);

  evidenceRows.push({
    id: 'api-key-hash',
    passed: true,
    storedPrefix: dbRow.api_key_prefix,
  });
});

test('Codex app-server thread/start must use YOLO sandbox and approval policy', async () => {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const transport = {
    async request(method: string, params: Record<string, unknown>) {
      requests.push({ method, params });
      if (method === 'thread/start') {
        return { thread: { id: `thread-${Date.now()}` } };
      }
      if (method === 'turn/start') {
        return { turn: { id: `turn-${Date.now()}` } };
      }
      return {};
    },
    onNotification() {},
    close() {},
  };

  await sendCodexAppServerMessage({
    ozwSessionId: `runtime-sandbox-${Date.now()}`,
    projectPath: workspaceRoot,
    text: 'verify runtime sandbox',
    permissionMode: 'default',
  }, transport);

  const threadStart = requests.find((request) => request.method === 'thread/start');
  assert.ok(threadStart, 'thread/start should be called for a new Codex app-server session');
  assert.equal(threadStart.params.sandbox, 'danger-full-access');
  assert.equal(threadStart.params.approvalPolicy, 'never');

  evidenceRows.push({
    id: 'codex-app-server-thread-start-policy',
    passed: true,
    sandbox: threadStart.params.sandbox,
    approvalPolicy: threadStart.params.approvalPolicy,
  });
});

test('Codex app-server default and bypass permissions stay in YOLO mode', async () => {
  const { __codexAppServerRuntimeInternalsForTest } = await import('../../backend/codex-app-server-runtime.ts');
  const defaultPolicy = __codexAppServerRuntimeInternalsForTest.resolveCodexRuntimePolicy('default');
  const bypassWithoutApprovalPolicy = __codexAppServerRuntimeInternalsForTest.resolveCodexRuntimePolicy('bypassPermissions');
  const cliArgs = __codexAppServerRuntimeInternalsForTest.buildCodexAppServerCliArgs();

  assert.equal(defaultPolicy.sandbox, 'danger-full-access');
  assert.equal(defaultPolicy.approvalPolicy, 'never');
  assert.equal(bypassWithoutApprovalPolicy.sandbox, 'danger-full-access');
  assert.equal(bypassWithoutApprovalPolicy.approvalPolicy, 'never');
  assert.ok(cliArgs.includes('sandbox_mode=danger-full-access'));
  assert.ok(cliArgs.includes('approval_policy=never'));
  assert.equal(cliArgs.includes('approval_policy=default'), false);

  evidenceRows.push({
    id: 'codex-app-server-cli-policy',
    passed: true,
    defaultPolicy,
    bypassWithoutApprovalPolicy,
    cliArgs,
  });
});

test('Codex app-server and native runtime permission modes inherit YOLO server policy', async () => {
  const { __codexAppServerRuntimeInternalsForTest } = await import('../../backend/codex-app-server-runtime.ts');
  const defaultPolicy = __codexAppServerRuntimeInternalsForTest.resolveCodexRuntimePolicy('default');
  const acceptEditsPolicy = __codexAppServerRuntimeInternalsForTest.resolveCodexRuntimePolicy('acceptEdits');
  const bypassPolicy = __codexAppServerRuntimeInternalsForTest.resolveCodexRuntimePolicy('bypassPermissions');
  const nativeDefaultPolicy = __nativeAgentRuntimeInternalsForTest.resolveCodexPermissionPolicy('default');
  const nativeBypassPolicy = __nativeAgentRuntimeInternalsForTest.resolveCodexPermissionPolicy('bypassPermissions');

  assert.equal(defaultPolicy.sandbox, 'danger-full-access');
  assert.equal(defaultPolicy.approvalPolicy, 'never');
  assert.equal(acceptEditsPolicy.sandbox, 'danger-full-access');
  assert.equal(acceptEditsPolicy.approvalPolicy, 'never');
  assert.equal(bypassPolicy.sandbox, 'danger-full-access');
  assert.equal(bypassPolicy.approvalPolicy, 'never');
  assert.equal(nativeDefaultPolicy.sandboxMode, defaultPolicy.sandbox);
  assert.equal(nativeDefaultPolicy.approvalPolicy, defaultPolicy.approvalPolicy);
  assert.equal(nativeBypassPolicy.sandboxMode, 'danger-full-access');
  assert.equal(nativeBypassPolicy.approvalPolicy, 'never');
  assert.equal(bypassPolicy.sandbox, nativeBypassPolicy.sandboxMode);
  assert.equal(bypassPolicy.approvalPolicy, nativeBypassPolicy.approvalPolicy);

  evidenceRows.push({
    id: 'codex-app-server-native-policy',
    passed: true,
    defaultPolicy,
    acceptEditsPolicy,
    bypassPolicy,
    nativeDefaultPolicy,
    nativeBypassPolicy,
  });
});
test('GitHub clone credentials must not place token in process argv or environment values', async () => {
  const secret = `ghp_runtime_secret_${Date.now()}`;
  const credentials = await createGitCredentialEnvironment(secret);

  try {
    assert.equal(credentials.env.GIT_TERMINAL_PROMPT, '0');
    assert.ok(credentials.env.GIT_ASKPASS, 'GIT_ASKPASS should be configured when token exists');
    assert.equal(String(credentials.env.GIT_ASKPASS).includes(secret), false, 'askpass path must not contain token');
    assert.equal(
      Object.values(credentials.env).some((value) => String(value || '').includes(secret)),
      false,
      'token must not be stored directly in git process environment values',
    );

    evidenceRows.push({
      id: 'github-token-not-in-git-argv',
      passed: true,
      hasAskPass: Boolean(credentials.env.GIT_ASKPASS),
    });
  } finally {
    await credentials.cleanup();
  }
});

test('Login route must rate-limit repeated failed password attempts', async () => {
  const { default: authRouter } = await import('../../backend/routes/auth.ts');
  const username = `rate-limit-${Date.now()}`;
  const passwordHash = await bcrypt.hash('correct-password', 12);
  userDb.createUser(username, passwordHash);

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'test server should expose an address');
    const url = `http://127.0.0.1:${address.port}/api/auth/login`;

    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      lastResponse = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'wrong-password' }),
      });
    }

    assert.equal(lastResponse?.status, 429);
    assert.ok(Number(lastResponse?.headers.get('retry-after')) > 0);

    evidenceRows.push({
      id: 'login-rate-limit',
      passed: true,
      status: lastResponse?.status,
      retryAfter: lastResponse?.headers.get('retry-after'),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('Recoverable credentials are encrypted at rest and decrypted on read', async () => {
  const user = await ensureLoggedInUser();
  const secret = 'ghp_plaintext_credential_for_test';
  const saved = credentialsDb.createCredential(user.id, 'ci-gh', 'github_token', secret, null);

  const freshRow = db.prepare('SELECT credential_value FROM user_credentials WHERE id = ?')
    .get(saved.id) as { credential_value: string };

  assert.equal(typeof freshRow.credential_value, 'string');
  assert.ok(__databaseInternalsForTest.isCredentialValueEncrypted(freshRow.credential_value));
  assert.notEqual(freshRow.credential_value, secret, 'Credential should not be stored as plain text');
  assert.equal(credentialsDb.getActiveCredential(user.id, 'github_token'), secret);
  assert.equal(credentialsDb.getCredentialById(user.id, saved.id, 'github_token'), secret);
  assert.equal(githubTokensDb.getGithubTokenById(user.id, saved.id), secret);

  const legacyUser = userDb.createUser(`runtime-legacy-user-${Date.now()}`, '$2b$12$abcdefghijklmnopqrstuvxyz01234567890123456789');
  const legacyStmt = db.prepare(`
    INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  const legacyId = Number(legacyStmt.run(
    legacyUser.id,
    'legacy',
    'github_token',
    'legacy_plain_secret',
    null,
  ).lastInsertRowid);

  assert.equal(credentialsDb.getActiveCredential(legacyUser.id, 'github_token'), 'legacy_plain_secret');
  assert.equal(credentialsDb.getCredentialById(legacyUser.id, legacyId, 'github_token'), 'legacy_plain_secret');

  const legacyRow = db.prepare('SELECT credential_value FROM user_credentials WHERE id = ?')
    .get(legacyId) as { credential_value: string };
  assert.notEqual(legacyRow.credential_value, 'legacy_plain_secret');
  assert.ok(__databaseInternalsForTest.isCredentialValueEncrypted(legacyRow.credential_value));

  const derivedKey = __databaseInternalsForTest.normalizeCredentialKey();
  assert.ok(Buffer.isBuffer(derivedKey));
  assert.equal(derivedKey.length, 32);

  const oldEncryptedUser = userDb.createUser(`runtime-old-encrypted-user-${Date.now()}`, '$2b$12$abcdefghijklmnopqrstuvxyz01234567890123456789');
  const oldEncryptedSecret = 'legacy_encrypted_secret';
  const oldEncryptedValue = encryptCredentialWithLegacyKey(oldEncryptedSecret);
  const oldEncryptedId = Number(legacyStmt.run(
    oldEncryptedUser.id,
    'legacy-encrypted',
    'github_token',
    oldEncryptedValue,
    null,
  ).lastInsertRowid);

  assert.equal(credentialsDb.getActiveCredential(oldEncryptedUser.id, 'github_token'), oldEncryptedSecret);

  const rewrittenRow = db.prepare('SELECT credential_value FROM user_credentials WHERE id = ?')
    .get(oldEncryptedId) as { credential_value: string };
  assert.notEqual(rewrittenRow.credential_value, oldEncryptedValue);
  assert.equal(__databaseInternalsForTest.decryptCredential(rewrittenRow.credential_value).plaintext, oldEncryptedSecret);

  const corruptedUser = userDb.createUser(`runtime-corrupted-user-${Date.now()}`, '$2b$12$abcdefghijklmnopqrstuvxyz01234567890123456789');
  const encryptedSecret = __databaseInternalsForTest.encryptCredential('corrupted_secret');
  const parts = encryptedSecret.split(':');
  parts[2] = `${parts[2].slice(0, -2)}00`;
  db.prepare(`
    INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(
    corruptedUser.id,
    'corrupted',
    'github_token',
    parts.join(':'),
    null,
  );

  assert.equal(credentialsDb.getActiveCredential(corruptedUser.id, 'github_token'), null);

  evidenceRows.push({
    id: 'credential-encryption',
    passed: true,
  });
});

test('HTTP/Shell/WebSocket clients must not carry token via query string', async () => {
  const backendIndexSource = await fs.readFile(path.join(process.cwd(), 'backend/index.ts'), 'utf8');
  const projectsRouteSource = await fs.readFile(path.join(process.cwd(), 'backend/routes/projects.ts'), 'utf8');
  const cloneJobStoreSource = await fs.readFile(path.join(process.cwd(), 'backend/clone-progress-job-store.ts'), 'utf8');
  const frontendSocketSource = await fs.readFile(path.join(process.cwd(), 'frontend/contexts/WebSocketContext.tsx'), 'utf8');
  const projectWizardSource = await fs.readFile(path.join(process.cwd(), 'frontend/components/projects/view/ProjectCreationWizard.tsx'), 'utf8');
  const shellSocketSource = await fs.readFile(path.join(process.cwd(), 'frontend/components/shell/utils/socket.ts'), 'utf8');
  const shellHookSource = await fs.readFile(path.join(process.cwd(), 'frontend/components/shell/hooks/useShellConnection.ts'), 'utf8');

  const sourceBundle = backendIndexSource + projectsRouteSource + frontendSocketSource + projectWizardSource + shellSocketSource + shellHookSource;
  assert.equal(/searchParams\.get\(['"]token['"]\)/.test(sourceBundle), false);
  assert.equal(/searchParams\.get\(['"]apiKey['"]\)/.test(sourceBundle), false);
  assert.equal(/\?(token|apiKey)=/.test(sourceBundle), false);
  assert.equal(/req\.query[\s\S]{0,120}newGithubToken/.test(projectsRouteSource), false);
  assert.equal(/URLSearchParams[\s\S]{0,240}newGithubToken/.test(projectWizardSource), false);
  assert.equal(/clone-progress\?\$\{[^}]*newGithubToken/.test(projectWizardSource), false);
  assert.match(projectWizardSource, /createCloneJob/);
  assert.match(projectWizardSource, /runCloneProgressStream/);
  assert.match(projectWizardSource, /job not found or expired/i);
  assert.match(projectsRouteSource, /clone-progress-job-store\.js/);
  assert.doesNotMatch(projectsRouteSource, /getDatabase/);
  assert.match(projectsRouteSource, /githubTokensDb\.getGithubTokenById/);
  assert.match(cloneJobStoreSource, /interface CloneProgressJobPayload/);
  assert.match(cloneJobStoreSource, /interface CloneProgressJob/);
  assert.equal(getWebSocketAuthToken({
    headers: {
      authorization: 'Bearer header-token',
    },
  }), 'header-token');
  assert.equal(getWebSocketAuthToken({
    headers: {},
  }), null);
  assert.equal(getWebSocketAuthToken({
    headers: {
      'sec-websocket-protocol': 'protocol-token',
    },
  }), 'protocol-token');

  evidenceRows.push({
    id: 'query-token-removed',
    passed: true,
  });
});
