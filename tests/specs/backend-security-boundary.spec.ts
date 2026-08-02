/**
 * Sources: 2026-06-11-94-收敛后端安全债务
 *
 * 文件目的：稳定验证后端认证、工作区路径、Codex 权限、GitHub token 和凭据持久化的安全边界。
 * 业务场景：用户通过登录、Agent、Git clone、WebSocket/Shell 和 provider 凭据功能操作项目时，认证信息不能通过 URL 或进程参数泄漏，无法解密的历史凭据也不能误传给外部工具。
 */
/// <reference path="../../backend/types.d.ts" />
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import test from 'node:test';

const originalEnv = {
  HOME: process.env.HOME,
  DATABASE_PATH: process.env.DATABASE_PATH,
  WORKSPACES_ROOT: process.env.WORKSPACES_ROOT,
  OZW_ACCESS_TOKEN: process.env.OZW_ACCESS_TOKEN,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
};

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-94-runtime-test-'));
const workspaceRoot = path.join(tempDir, 'workspace');
await fs.mkdir(workspaceRoot, { recursive: true });

process.env.HOME = tempDir;
process.env.WORKSPACES_ROOT = workspaceRoot;
process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
process.env.OZW_ACCESS_TOKEN = '0123456789abcdef0123456789abcdef';
process.env.JWT_EXPIRES_IN = '2h';

const runtimeLogPath = path.join(process.cwd(), 'test-results/94-backend-security/runtime-log.json');

const {
  userDb,
  apiKeysDb,
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

await initializeDatabase();

const evidenceRows: Array<Record<string, unknown>> = [];

async function ensureLoggedInUser() {
  return userDb.getSingleUser();
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

  if (originalEnv.OZW_ACCESS_TOKEN === undefined) {
    delete process.env.OZW_ACCESS_TOKEN;
  } else {
    process.env.OZW_ACCESS_TOKEN = originalEnv.OZW_ACCESS_TOKEN;
  }

  if (originalEnv.JWT_EXPIRES_IN === undefined) {
    delete process.env.JWT_EXPIRES_IN;
  } else {
    process.env.JWT_EXPIRES_IN = originalEnv.JWT_EXPIRES_IN;
  }

  await fs.mkdir(path.dirname(runtimeLogPath), { recursive: true });
  await fs.writeFile(runtimeLogPath, JSON.stringify({ checks: evidenceRows }, null, 2), 'utf8');
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('JWT token must include expiration and use an automatically managed secret', async () => {
  const user = await ensureLoggedInUser();
  const token = generateToken({ id: user.id, username: user.username });
  const claims = jwt.decode(token) as jwt.JwtPayload;
  assert.equal(typeof claims?.exp, 'number', 'Generated token should include exp');
  assert.equal(claims?.userId, user.id, 'Token claims should carry user id');

  const signingSecret = __authInternalsForTest.getJwtSecret();
  assert.equal(Buffer.from(signingSecret, 'base64url').length, 32);
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

test('Codex app-server leaves sandbox and approval policy to the independent service', async () => {
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
  assert.equal('sandbox' in threadStart.params, false);
  assert.equal('approvalPolicy' in threadStart.params, false);
  assert.equal(threadStart.params.multiAgentMode, 'proactive');

  const turnStart = requests.find((request) => request.method === 'turn/start');
  assert.ok(turnStart, 'turn/start should be called for a new Codex app-server session');
  assert.equal(turnStart.params.multiAgentMode, 'proactive');

  evidenceRows.push({
    id: 'codex-app-server-independent-policy',
    passed: true,
    multiAgentMode: threadStart.params.multiAgentMode,
  });
});

test('Codex client proxy does not carry service policy overrides', async () => {
  const { __codexAppServerRuntimeInternalsForTest } = await import('../../backend/codex-app-server-runtime.ts');
  const cliArgs = __codexAppServerRuntimeInternalsForTest.buildCodexAppServerCliArgs();

  assert.deepEqual(cliArgs.slice(0, 3), ['app-server', 'proxy', '--sock']);
  assert.match(cliArgs[3], /app-server-control\.sock$/);
  assert.equal(cliArgs.some((arg) => /sandbox|approval/i.test(arg)), false);

  evidenceRows.push({
    id: 'codex-app-server-client-only-args',
    passed: true,
    cliArgs,
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

test('Access-token login must rate-limit repeated failed attempts', async () => {
  const { default: authRouter } = await import('../../backend/routes/auth.ts');

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
        body: JSON.stringify({ accessToken: 'ffffffffffffffffffffffffffffffff' }),
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

test('Legacy encrypted provider credentials are rejected instead of forwarded as tokens', async () => {
  /**
   * PURPOSE: Prevent an unreadable historical ciphertext from reaching Git or Agent as if it were a valid token.
   */
  const user = userDb.getSingleUser();
  const legacyCiphertext = `${'a'.repeat(24)}:${'b'.repeat(32)}:${'c'.repeat(16)}`;
  const result = db.prepare(`
    INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(user.id, 'legacy-encrypted', 'github_token', legacyCiphertext, null);

  assert.equal(githubTokensDb.getActiveGithubToken(user.id), null);
  assert.equal(githubTokensDb.getGithubTokenById(user.id, Number(result.lastInsertRowid)), null);

  evidenceRows.push({
    id: 'legacy-credential-rejected',
    passed: true,
  });
});

test('HTTP/Shell/WebSocket clients must not carry token via query string', async () => {
  const backendIndexSource = await fs.readFile(path.join(process.cwd(), 'backend/index.ts'), 'utf8');
  const projectsRouteSource = await fs.readFile(path.join(process.cwd(), 'backend/routes/projects.ts'), 'utf8');
  const cloneJobStoreSource = await fs.readFile(path.join(process.cwd(), 'backend/clone-progress-job-store.ts'), 'utf8');
  const frontendApiSource = await fs.readFile(path.join(process.cwd(), 'frontend/utils/api.ts'), 'utf8');
  const frontendSocketSource = await fs.readFile(path.join(process.cwd(), 'frontend/contexts/WebSocketContext.tsx'), 'utf8');
  const projectWizardSource = await fs.readFile(path.join(process.cwd(), 'frontend/components/projects/view/ProjectCreationWizard.tsx'), 'utf8');
  const shellSocketSource = await fs.readFile(path.join(process.cwd(), 'frontend/components/shell/utils/socket.ts'), 'utf8');
  const shellHookSource = await fs.readFile(path.join(process.cwd(), 'frontend/components/shell/hooks/useShellConnection.ts'), 'utf8');

  const sourceBundle = backendIndexSource + projectsRouteSource + frontendApiSource + frontendSocketSource + projectWizardSource + shellSocketSource + shellHookSource;
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
  assert.match(frontendApiSource, /Authorization.*Bearer/);
  assert.doesNotMatch(frontendApiSource, /IS_PLATFORM/);
  assert.doesNotMatch(frontendSocketSource, /IS_PLATFORM|isLoopbackBrowserHost/);
  assert.match(frontendSocketSource, /new WebSocket\(wsUrl, token \? \[token\]/);
  assert.doesNotMatch(shellSocketSource, /IS_PLATFORM|isLoopbackBrowserHost/);
  assert.match(shellSocketSource, /protocol: token/);
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
