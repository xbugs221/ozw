/**
 * 文件目的：从真实 npm 压缩包验收 ozw 的全局安装、用户态初始化与数据保留边界。
 */
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = process.cwd();
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const REQUIRED_PACKAGE_FILES = [
  'LICENSE',
  'README.md',
  'package.json',
  'dist/index.html',
  'dist-node/backend/cli.js',
  'dist-node/backend/index.js',
  'dist-node/backend/database/init.sql',
];

type PackMetadata = {
  filename: string;
  version: string;
  files: Array<{ path: string }>;
};

type DistributionFixture = {
  root: string;
  prefix: string;
  home: string;
  npmCache: string;
  tarball: string;
  packageRoot: string;
  executable: string;
  metadata: PackMetadata;
};

type RunningServer = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  baseUrl: string;
  output: () => string;
};

let fixture: DistributionFixture;

/** Run a command and retain stderr in any actionable failure. */
async function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd ?? REPOSITORY_ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Return the launcher and installed package paths for an isolated npm prefix. */
async function resolveInstalledPaths(prefix: string): Promise<{ executable: string; packageRoot: string }> {
  const executable = process.platform === 'win32'
    ? path.join(prefix, 'ozw.cmd')
    : path.join(prefix, 'bin', 'ozw');
  const { stdout } = await run(NPM, ['root', '--global', '--prefix', prefix]);
  return { executable, packageRoot: path.join(stdout.trim(), 'ozw') };
}

/** Install one real tarball into an isolated global npm prefix. */
async function installTarball(target: DistributionFixture, tarball = target.tarball): Promise<void> {
  await run(NPM, [
    'install', '--global', '--prefix', target.prefix, '--cache', target.npmCache,
    '--no-audit', '--no-fund', '--no-update-notifier', tarball,
  ], { cwd: target.root, env: targetEnvironment(target) });
}

/** Build, pack and globally install the immutable candidate once for this suite. */
async function createDistributionFixture(): Promise<DistributionFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ozw-npm-global-'));
  const target: DistributionFixture = {
    root,
    prefix: path.join(root, 'prefix'),
    home: path.join(root, 'home'),
    npmCache: path.join(root, 'npm-cache'),
    tarball: '',
    packageRoot: '',
    executable: '',
    metadata: { filename: '', version: '', files: [] },
  };
  fs.mkdirSync(target.home, { recursive: true });

  await run(PNPM, ['run', 'build']);

  const { stdout } = await run(NPM, [
    'pack', '--ignore-scripts', '--json', '--pack-destination', root,
  ]);
  const results = JSON.parse(stdout) as PackMetadata[];
  assert.equal(results.length, 1, 'npm pack 必须只生成一个候选包');
  target.metadata = results[0];
  target.tarball = path.join(root, results[0].filename);
  await run(process.execPath, [path.join(REPOSITORY_ROOT, 'scripts', 'verify-npm-package.mjs'), target.tarball]);
  await installTarball(target);
  Object.assign(target, await resolveInstalledPaths(target.prefix));
  return target;
}

/** Reset only the isolated user home while reusing the immutable installed package. */
async function resetUserHome(target: DistributionFixture): Promise<void> {
  await rm(target.home, { recursive: true, force: true });
  fs.mkdirSync(target.home, { recursive: true });
}

/** Derive a lower prerelease tarball so npm performs a real version upgrade to the candidate. */
async function createPriorVersionTarball(target: DistributionFixture): Promise<{ tarball: string; version: string }> {
  const sourceRoot = path.join(target.root, 'prior-package-source');
  fs.mkdirSync(sourceRoot, { recursive: true });
  await run('tar', ['-xf', target.tarball, '-C', sourceRoot], { cwd: target.root });
  const packageJsonPath = path.join(sourceRoot, 'package', 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string };
  const version = `${packageJson.version}-distribution-test.0`;
  packageJson.version = version;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  const { stdout } = await run(NPM, [
    'pack', path.dirname(packageJsonPath), '--ignore-scripts', '--json', '--pack-destination', target.root,
  ], { cwd: target.root });
  const results = JSON.parse(stdout) as PackMetadata[];
  assert.equal(results.length, 1, '旧版候选包必须唯一');
  return { tarball: path.join(target.root, results[0].filename), version };
}

/** Produce the isolated HOME and runtime environment used by installed commands. */
function targetEnvironment(target: DistributionFixture, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const binDirectory = process.platform === 'win32' ? target.prefix : path.join(target.prefix, 'bin');
  const env = { ...process.env };
  delete env.OZW_HOME;
  delete env.OZW_ACCESS_TOKEN;
  delete env.OZW_JWT_SECRET_PATH;
  delete env.DATABASE_PATH;
  delete env.HOST;
  delete env.PORT;
  return {
    ...env,
    HOME: target.home,
    USERPROFILE: target.home,
    NODE_ENV: 'production',
    PATH: `${binDirectory}${path.delimiter}${env.PATH ?? ''}`,
    XDG_CACHE_HOME: path.join(target.home, '.cache'),
    XDG_CONFIG_HOME: path.join(target.home, '.config'),
    XDG_STATE_HOME: path.join(target.home, '.local', 'state'),
    npm_config_cache: target.npmCache,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    ...overrides,
  };
}

/** Reserve a loopback port for one short-lived installed service. */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('无法分配本地端口'));
        return;
      }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

/** Remove secrets and terminal colour codes before attaching process output to errors. */
function redactOutput(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/(Access token:\s*)\S+/giu, '$1<redacted>')
    .replace(/(OZW_ACCESS_TOKEN=)[A-Za-z0-9_-]+/gu, '$1<redacted>');
}

/** Start the globally installed command and wait until its real health route responds. */
async function startInstalledServer(
  target: DistributionFixture,
  overrides: NodeJS.ProcessEnv = {},
): Promise<RunningServer> {
  const port = overrides.PORT ? Number(overrides.PORT) : await getFreePort();
  let stdout = '';
  let stderr = '';
  const child = spawn(target.executable, ['--port', String(port)], {
    cwd: target.root,
    env: targetEnvironment(target, overrides),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const result: RunningServer = {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
    output: () => `${stdout}\n${stderr}`,
  };

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`ozw 启动前退出 (${child.exitCode})\n${redactOutput(result.output())}`);
    }
    try {
      const response = await fetch(`${result.baseUrl}/health`);
      if (response.ok) return result;
    } catch {
      // Listener is not ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await stopServer(result);
  throw new Error(`ozw 健康检查超时\n${redactOutput(result.output())}`);
}

/** Stop one server without leaving an npm-installed process behind. */
async function stopServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => server.child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

/** Read the single persisted access token without exposing it in test output. */
async function readAccessToken(home = fixture.home): Promise<string> {
  const contents = await readFile(path.join(home, '.ozw', '.env'), 'utf8');
  const match = contents.match(/^OZW_ACCESS_TOKEN=(.+)$/mu);
  assert.ok(match, '用户 .env 必须包含 OZW_ACCESS_TOKEN');
  return match[1];
}

/** Trigger JWT creation through the public login contract. */
async function login(server: RunningServer, accessToken: string): Promise<{
  token: string;
  user: { id: number; created_at: string };
}> {
  const response = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  assert.equal(response.ok, true, `登录必须成功：${response.status}`);
  const payload = await response.json() as {
    token?: string;
    user?: { id?: number; created_at?: string };
  };
  assert.equal(typeof payload.token, 'string', '登录必须返回 JWT');
  assert.equal(typeof payload.user?.id, 'number', '登录必须返回持久化用户');
  assert.equal(typeof payload.user?.created_at, 'string', '登录必须返回用户创建时间');
  return payload as { token: string; user: { id: number; created_at: string } };
}

/** Prove one server accepts a JWT minted by another concurrent server. */
async function authenticate(server: RunningServer, jwt: string): Promise<void> {
  const response = await fetch(`${server.baseUrl}/api/auth/user`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  assert.equal(response.ok, true, '并发进程必须共享同一 JWT 密钥');
}

/** Hash persisted secrets so assertions never print their plaintext. */
function digest(contents: Buffer | string): string {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

/** Recursively make only the installed package immutable for the POSIX scenario. */
async function makeReadOnly(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await makeReadOnly(entryPath);
      await chmod(entryPath, 0o555);
    } else {
      const existingMode = (await stat(entryPath)).mode;
      await chmod(entryPath, existingMode & 0o111 ? 0o555 : 0o444);
    }
  }
  await chmod(directory, 0o555);
}

/** Restore directory write permission so the isolated fixture can be removed safely. */
async function makeWritable(directory: string): Promise<void> {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await makeWritable(entryPath);
    } else {
      const existingMode = (await stat(entryPath)).mode;
      await chmod(entryPath, existingMode & 0o111 ? 0o755 : 0o644);
    }
  }
}

/** Find forbidden mutable application state under the installed package root. */
async function findMutableInstallArtifacts(directory: string): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (/^(?:\.env|\.jwt-secret|ozw\.db(?:-(?:wal|shm))?)$/u.test(entry.name)) {
        matches.push(path.relative(directory, entryPath));
      }
    }
  };
  await visit(directory);
  return matches;
}

before(async () => {
  fixture = await createDistributionFixture();
});

after(async () => {
  if (fixture?.root) await rm(fixture.root, { recursive: true, force: true });
});

test('真实压缩包可全局安装并直接启动', async () => {
  const paths = new Set(fixture.metadata.files.map(file => file.path));
  for (const requiredPath of REQUIRED_PACKAGE_FILES) {
    assert.equal(paths.has(requiredPath), true, `发行包缺少 ${requiredPath}`);
  }
  const forbidden = [...paths].filter(filePath =>
    /(?:^|\/)(?:tests?|scripts)(?:\/|$)/u.test(filePath)
    || /\.(?:ts|tsx|map)$/iu.test(filePath),
  );
  assert.deepEqual(forbidden, [], '发行包不得包含 TypeScript、source map、测试或 scripts');

  const packageJson = JSON.parse(await readFile(path.join(fixture.packageRoot, 'package.json'), 'utf8')) as {
    bin?: { ozw?: string };
    scripts?: { postinstall?: string };
    version: string;
  };
  assert.equal(packageJson.bin?.ozw, 'dist-node/backend/cli.js');
  assert.equal(packageJson.scripts?.postinstall, undefined);
  const version = await run(fixture.executable, ['--version'], {
    cwd: fixture.root,
    env: targetEnvironment(fixture),
  });
  assert.equal(version.stdout.trim(), fixture.metadata.version);

  const server = await startInstalledServer(fixture);
  try {
    const health = await fetch(`${server.baseUrl}/health`);
    assert.equal(health.ok, true);
    assert.equal((await health.json() as { status?: string }).status, 'ok');

    const homepage = await fetch(`${server.baseUrl}/`);
    assert.equal(homepage.ok, true);
    assert.match(await homepage.text(), /<!doctype html>/iu);

    const authStatus = await fetch(`${server.baseUrl}/api/auth/status`);
    assert.equal(authStatus.ok, true);
    assert.equal((await authStatus.json() as { accessTokenConfigured?: boolean }).accessTokenConfigured, true);
    assert.doesNotMatch(server.output(), /(?:pnpm|tsx|tsc|vite)(?:\s+run|\s+build|\s+-p)/iu);
  } finally {
    await stopServer(server);
  }
});

test('首次运行幂等创建用户配置和秘密', async () => {
  await resetUserHome(fixture);
  const userDirectory = path.join(fixture.home, '.ozw');
  const envPath = path.join(userDirectory, '.env');
  const jwtPath = path.join(userDirectory, '.jwt-secret');
  const databasePath = path.join(userDirectory, 'ozw.db');
  let server = await startInstalledServer(fixture);
  const firstOutput = server.output();
  const token = await readAccessToken();
  await login(server, token);
  await stopServer(server);

  assert.equal(token.length, 32);
  assert.match(token, /^[A-Za-z0-9_-]{32}$/u);
  const envContents = await readFile(envPath, 'utf8');
  const jwtContents = await readFile(jwtPath);
  assert.equal(envContents.includes(jwtContents.toString('utf8')), false, 'JWT 密钥不得写入 .env');
  assert.equal(firstOutput.includes(jwtContents.toString('utf8')), false, 'JWT 密钥不得输出到日志');
  assert.equal(fs.existsSync(databasePath), true);
  if (process.platform !== 'win32') {
    assert.equal((await stat(userDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);
    assert.equal((await stat(jwtPath)).mode & 0o777, 0o600);
  }

  const original = {
    env: digest(envContents),
    jwt: digest(jwtContents),
  };
  server = await startInstalledServer(fixture);
  try {
    assert.equal(await readAccessToken(), token);
    assert.equal(server.output().includes(token), false, '重复启动不得再次显示访问令牌');
  } finally {
    await stopServer(server);
  }
  assert.equal(digest(await readFile(envPath)), original.env);
  assert.equal(digest(await readFile(jwtPath)), original.jwt);

  await resetUserHome(fixture);
  const [firstConcurrent, secondConcurrent] = await Promise.all([
    startInstalledServer(fixture),
    startInstalledServer(fixture),
  ]);
  try {
    const concurrentToken = await readAccessToken();
    assert.equal(concurrentToken.length, 32);
    const concurrentEnvDigest = digest(await readFile(envPath));
    const firstLogin = await login(firstConcurrent, concurrentToken);
    await authenticate(secondConcurrent, firstLogin.token);
    assert.equal(await readAccessToken(), concurrentToken);
    const concurrentJwtDigest = digest(await readFile(jwtPath));
    assert.equal(digest(await readFile(envPath)), concurrentEnvDigest);
    assert.equal(digest(await readFile(jwtPath)), concurrentJwtDigest);
  } finally {
    await Promise.all([stopServer(firstConcurrent), stopServer(secondConcurrent)]);
  }
});

test('只读安装目录与统一用户目录', async () => {
  const supportsPosixModes = process.platform !== 'win32';
  if (supportsPosixModes) {
    await makeReadOnly(fixture.packageRoot);
    assert.equal((await stat(fixture.packageRoot)).mode & 0o222, 0);
  }
  try {
    const server = await startInstalledServer(fixture);
    try {
      assert.equal((await fetch(`${server.baseUrl}/health`)).ok, true);
    } finally {
      await stopServer(server);
    }
    const statusResult = await run(fixture.executable, ['status'], {
      cwd: fixture.root,
      env: targetEnvironment(fixture),
    });
  const statusOutput = statusResult.stdout.replace(/\u001b\[[0-9;]*m/gu, '');
    assert.match(statusOutput, /HOST:\s+127\.0\.0\.1\s+\(default\)/u);
    assert.match(statusOutput, new RegExp(path.join(fixture.home, '.ozw', '.env').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
    assert.match(statusOutput, new RegExp(path.join(fixture.home, '.ozw', 'ozw.db').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
    assert.deepEqual(await findMutableInstallArtifacts(fixture.packageRoot), []);
  } finally {
    if (supportsPosixModes) await makeWritable(fixture.packageRoot);
  }
});

test('全局升级和卸载保留用户数据', async () => {
  const upgradeRoot = await mkdtemp(path.join(os.tmpdir(), 'ozw-npm-upgrade-'));
  const target: DistributionFixture = {
    ...fixture,
    root: upgradeRoot,
    prefix: path.join(upgradeRoot, 'prefix'),
    home: path.join(upgradeRoot, 'home'),
    npmCache: path.join(upgradeRoot, 'npm-cache'),
    packageRoot: '',
    executable: '',
  };
  fs.mkdirSync(target.home, { recursive: true });
  try {
    const priorCandidate = await createPriorVersionTarball(target);
    await installTarball(target, priorCandidate.tarball);
    Object.assign(target, await resolveInstalledPaths(target.prefix));
    const installedPriorVersion = await run(target.executable, ['--version'], {
      cwd: target.root,
      env: targetEnvironment(target),
    });
    assert.equal(installedPriorVersion.stdout.trim(), priorCandidate.version);
    let server = await startInstalledServer(target);
    const token = await readAccessToken(target.home);
    const initialLogin = await login(server, token);
    await stopServer(server);

    const stateDirectory = path.join(target.home, '.ozw');
    const envPath = path.join(stateDirectory, '.env');
    const jwtPath = path.join(stateDirectory, '.jwt-secret');
    const databasePath = path.join(stateDirectory, 'ozw.db');
    const beforeUpgrade = {
      env: digest(await readFile(envPath)),
      jwt: digest(await readFile(jwtPath)),
    };

    await installTarball(target);
    const installedCandidateVersion = await run(target.executable, ['--version'], {
      cwd: target.root,
      env: targetEnvironment(target),
    });
    assert.equal(installedCandidateVersion.stdout.trim(), fixture.metadata.version);
    assert.notEqual(installedCandidateVersion.stdout.trim(), priorCandidate.version);
    server = await startInstalledServer(target);
    try {
      assert.equal(await readAccessToken(target.home), token);
      assert.equal((await fetch(`${server.baseUrl}/health`)).ok, true);
      const upgradedLogin = await login(server, token);
      assert.equal(upgradedLogin.user.id, initialLogin.user.id);
      assert.equal(upgradedLogin.user.created_at, initialLogin.user.created_at);
    } finally {
      await stopServer(server);
    }
    assert.equal(digest(await readFile(envPath)), beforeUpgrade.env);
    assert.equal(digest(await readFile(jwtPath)), beforeUpgrade.jwt);
    assert.equal(fs.existsSync(databasePath), true);

    await run(NPM, [
      'uninstall', '--global', '--prefix', target.prefix, '--cache', target.npmCache,
      '--no-audit', '--no-fund', 'ozw',
    ], { cwd: target.root, env: targetEnvironment(target) });
    assert.equal(fs.existsSync(target.executable), false, '卸载必须移除全局命令');
    assert.equal(fs.existsSync(target.packageRoot), false, '卸载必须移除全局包');
    assert.equal(digest(await readFile(envPath)), beforeUpgrade.env);
    assert.equal(digest(await readFile(jwtPath)), beforeUpgrade.jwt);
    assert.equal(fs.existsSync(databasePath), true, '卸载必须保留用户数据库');
  } finally {
    await rm(upgradeRoot, { recursive: true, force: true });
  }
});
