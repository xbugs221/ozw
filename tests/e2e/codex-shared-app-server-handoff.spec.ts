/**
 * 文件目的：自举隔离的真实 Codex daemon，并用真实浏览器和官方远端终端验证无损接管。
 * 业务意义：验收无需人工注入会话编号，且所有要求的运行证据都由同一次真实执行产生。
 */
import { expect, test } from '@playwright/test';
import { execFile, execFileSync, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createStdioAppServerTransport, type CodexAppServerTransport } from '../../backend/domains/codex-app-server/stdio-transport.ts';
import { createJsonRpcLineTransport } from '../../backend/domains/codex-app-server/json-rpc-line-transport.ts';
import { createTmuxTerminalRuntime } from '../../backend/server/terminal-tmux-runtime.ts';
import {
  resolveCodexDaemonNetworkPolicy,
  writeCodexDaemonNetworkState,
} from '../../backend/domains/codex-app-server/daemon-network-policy.ts';
import {
  authHeaders,
  authenticatePage,
  getFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';

const execFileAsync = promisify(execFile);
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/codex-shared-runtime');
const CODEX_HOME = path.join(process.env.HOME || '', '.codex');
const SOCKET_PATH = path.join(CODEX_HOME, 'app-server-control', 'app-server-control.sock');
const ORIGINAL_HOME = process.env.PLAYWRIGHT_ORIGINAL_HOME || '/home/zzl';
let daemonStartedByTest = false;

/** 等待条件成立，超时后给出明确错误。 */
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待真实 Codex 状态超时（${timeoutMs}ms）`);
}

/** 执行 daemon 子命令并返回标准输出。 */
async function daemon(command: string): Promise<string> {
  const result = await execFileAsync('codex', ['app-server', 'daemon', command], {
    env: { ...process.env, CODEX_HOME },
    timeout: 20_000,
  });
  return String(result.stdout || '').trim();
}

/** 在 Playwright 隔离 HOME 中准备真实认证与受管 Codex 可执行文件。 */
async function prepareCodexHome(): Promise<void> {
  process.env.CODEX_HOME = CODEX_HOME;
  const managedDir = path.join(CODEX_HOME, 'packages', 'standalone', 'current');
  await mkdir(managedDir, { recursive: true });
  await rm(path.join(managedDir, 'codex'), { force: true });
  await symlink(execFileSync('which', ['codex'], { encoding: 'utf8' }).trim(), path.join(managedDir, 'codex'));
  for (const fileName of ['auth.json', 'config.toml']) {
    const target = path.join(ORIGINAL_HOME, '.codex', fileName);
    const link = path.join(CODEX_HOME, fileName);
    await rm(link, { force: true });
    await symlink(target, link);
  }
}

/** 准备隔离 HOME，并启动真实共享 daemon。 */
async function prepareRealDaemon(): Promise<Record<string, unknown>> {
  await prepareCodexHome();
  let version: Record<string, unknown> | null = null;
  try {
    version = JSON.parse(await daemon('version')) as Record<string, unknown>;
  } catch {
    await daemon('enable-remote-control');
    await daemon('start');
    version = JSON.parse(await daemon('version')) as Record<string, unknown>;
  }
  const networkPolicy = resolveCodexDaemonNetworkPolicy({
    mode: process.env.OZW_CODEX_PROXY_MODE === 'off' ? 'off' : 'inherit',
    env: process.env,
  });
  writeCodexDaemonNetworkState(CODEX_HOME, {
    appliedFingerprint: networkPolicy.fingerprint,
    pendingFingerprint: null,
  });
  daemonStartedByTest = true;
  return version;
}

/** 启动不连接共享 daemon 的真实私有 app-server，用于构造迁移前线程。 */
async function startPrivateAppServer(): Promise<{
  child: ChildProcessWithoutNullStreams;
  transport: CodexAppServerTransport;
}> {
  await prepareCodexHome();
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
    env: { ...process.env, CODEX_HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { child, transport: createJsonRpcLineTransport(child) };
}

/** 关闭私有 app-server 并等待进程退出，确保线程不再被旧运行时持有。 */
async function stopPrivateAppServer(input: {
  child: ChildProcessWithoutNullStreams;
  transport: CodexAppServerTransport;
}): Promise<void> {
  input.transport.close();
  await waitFor(() => input.child.exitCode !== null || input.child.signalCode !== null, 10_000);
}

/** 启动官方远端终端，并将真实终端输出保存为证据。 */
function startRemoteTui(threadId: string): ChildProcess {
  const command = `codex --remote unix://${SOCKET_PATH} resume ${threadId}`;
  return spawn('script', ['-qefc', command, path.join(EVIDENCE_DIR, 'remote-tui.log')], {
    detached: true,
    env: { ...process.env, CODEX_HOME, TERM: 'xterm-256color' },
    stdio: 'ignore',
  });
}

/** 终止终端进程组，仅断开客户端而不停止 daemon。 */
function stopRemoteTui(child: ChildProcess): void {
  if (!child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 终端已退出。 */ }
}

/** 关闭连接并等待 proxy 正常退出。 */
function closeTransport(transport: CodexAppServerTransport): void {
  transport.close();
}

/** 清理隔离夹具上一次失败遗留的同名 tmux，避免错误复用旧线程。 */
async function killFixtureTmux(projectPath: string, routeSessionId: string): Promise<void> {
  const runtime = createTmuxTerminalRuntime(`${projectPath}_codex_route:${routeSessionId}`);
  for (const sessionName of [runtime.sessionName, ...runtime.legacySessionNames]) {
    await execFileAsync('tmux', ['kill-session', '-t', sessionName]).catch(() => undefined);
  }
}

/** 判断隔离项目的指定路由是否创建了受管 tmux。 */
async function fixtureTmuxExists(projectPath: string, routeSessionId: string): Promise<boolean> {
  const runtime = createTmuxTerminalRuntime(`${projectPath}_codex_route:${routeSessionId}`);
  try {
    await execFileAsync('tmux', ['has-session', '-t', runtime.sessionName]);
    return true;
  } catch {
    return false;
  }
}

/** 读取 Unix Socket 的真实 daemon 进程号，禁止以空值相等冒充生命周期稳定。 */
async function readDaemonPid(): Promise<number> {
  const result = await execFileAsync('lsof', ['-t', SOCKET_PATH]);
  const pid = Number(String(result.stdout || '').trim().split(/\s+/)[0]);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('未能从 daemon Socket 读取有效 PID');
  return pid;
}

/** 从 thread/read 快照核实同一活动轮次仍由共享 daemon 承载。 */
function assertActiveTurnSnapshot(snapshot: unknown, threadId: string, turnId: string): void {
  const serialized = JSON.stringify(snapshot);
  expect(serialized).toContain(threadId);
  expect(serialized).toContain(turnId);
  expect(serialized).toMatch(/inProgress|active|running/);
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  /** 测试只停止自己启动的隔离 daemon，不触碰用户真实 daemon。 */
  if (daemonStartedByTest) await daemon('stop').catch(() => '');
});

test('共享 daemon 增加 ozw 与官方终端连接时保持同一 active turn', async ({ page, request }) => {
  test.setTimeout(120_000);
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const beforeDaemon = await prepareRealDaemon();
  const owner = createStdioAppServerTransport();
  const observer = createStdioAppServerTransport();
  const notifications: Array<{ method: string; params: unknown }> = [];
  owner.onNotification((notification) => notifications.push(notification));

  const threadResult = await owner.request('thread/start', {
    cwd: PRIMARY_FIXTURE_PROJECT_PATH, sandbox: 'danger-full-access', approvalPolicy: 'never', model: null,
  }) as { thread: { id: string } };
  const turnResult = await owner.request('turn/start', {
    threadId: threadResult.thread.id,
    input: [{ type: 'text', text: 'Run `sleep 8` in the terminal, then reply only: done.', text_elements: [] }],
  }) as { turn: { id: string } };
  const threadId = threadResult.thread.id;
  const turnId = turnResult.turn.id;
  expect(threadId).toBeTruthy();
  expect(turnId).toBeTruthy();
  const beforePid = await readDaemonPid();
  const beforeSnapshot = await observer.request('thread/read', { threadId, includeTurns: true });
  assertActiveTurnSnapshot(beforeSnapshot, threadId, turnId);

  const tui = startRemoteTui(threadId);
  await waitFor(async () => (await readFile(path.join(EVIDENCE_DIR, 'remote-tui.log'), 'utf8').catch(() => '')).includes(threadId), 15_000);

  const project = await getFixtureProject(request);
  const projectName = String(project.name);
  const projectPath = String(project.fullPath || PRIMARY_FIXTURE_PROJECT_PATH);
  const draftResponse = await request.post(`/api/projects/${encodeURIComponent(projectName)}/manual-sessions`, {
    headers: authHeaders(),
    data: { provider: 'codex', label: '真实共享接管', projectPath },
  });
  expect(draftResponse.ok()).toBeTruthy();
  const draftPayload = await draftResponse.json() as { session?: { id?: string } };
  const routeSessionId = String(draftPayload.session?.id || '');
  expect(routeSessionId).toMatch(/^c\d+$/);
  await killFixtureTmux(projectPath, routeSessionId);
  const finalizeResponse = await request.post(
    `/api/projects/${encodeURIComponent(projectName)}/manual-sessions/${routeSessionId}/finalize`,
    { headers: authHeaders(), data: { provider: 'codex', actualSessionId: threadId, projectPath } },
  );
  expect(finalizeResponse.ok()).toBeTruthy();

  const shellFrames: string[] = [];
  page.on('websocket', (socket) => socket.on('framesent', (event) => shellFrames.push(String(event.payload))));
  await authenticatePage(page);
  const routePrefix = String((project as { routePath?: string }).routePath || `/projects/${encodeURIComponent(projectName)}`);
  await page.goto(`${routePrefix}/${routeSessionId}`, { waitUntil: 'networkidle' });
  await page.getByTestId('tab-shell').click();
  await waitFor(() => shellFrames.some((frame) => frame.includes(threadId)), 15_000);
  const ozwSnapshot = await observer.request('thread/read', { threadId, includeTurns: true });
  assertActiveTurnSnapshot(ozwSnapshot, threadId, turnId);

  /**
   * Create an OZW-only cN route and let the shell backend create and bind its
   * real shared thread. Reloading the same URL must keep one route and no warning.
   */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(routePrefix, { waitUntil: 'networkidle' });
  const manualSessions = page.getByTestId('project-overview-manual-sessions');
  await manualSessions.getByRole('button', { name: /新建会话|New Session/i }).click();
  await page.getByTestId('project-new-session-provider-codex').click();
  await page.waitForURL(/\/c\d+(?:\?|$)/, { timeout: 15_000 });
  const newRouteSessionId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) || '';
  const newRouteIndex = Number(newRouteSessionId.replace(/^c/, ''));
  expect(newRouteSessionId).toMatch(/^c\d+$/);
  await killFixtureTmux(projectPath, newRouteSessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('unsafe-codex-handoff-warning')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /Terminal input|消息输入|Message input/i })).toBeVisible();
  await waitFor(async () => {
    const response = await request.get('/api/codex/sessions', {
      headers: authHeaders(),
      params: { projectPath },
    });
    const payload = await response.json() as { sessions?: Array<{ routeIndex?: number; providerSessionId?: string }> };
    return payload.sessions?.some((session) => session.routeIndex === newRouteIndex && Boolean(session.providerSessionId)) === true;
  }, 20_000);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('unsafe-codex-handoff-warning')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /Terminal input|消息输入|Message input/i })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'ozw-new-session-mobile-refresh-rebound.png'), fullPage: true });

  const diagnosticsResponse = await request.get('/api/diagnostics/codex-shared-runtime', { headers: authHeaders() });
  const diagnostics = await diagnosticsResponse.json() as { network?: { fingerprint?: string } };
  writeCodexDaemonNetworkState(CODEX_HOME, {
    appliedFingerprint: 'previous-network-fingerprint',
    pendingFingerprint: diagnostics.network?.fingerprint || null,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.openSettings?.('diagnostics'));
  await expect(page.getByTestId('codex-runtime-mode')).toContainText('shared-daemon', { timeout: 30_000 });
  await expect(page.getByTestId('codex-proxy-restart-warning')).toContainText(/活动会话|active turn/i);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'proxy-restart-warning.png'), fullPage: true });

  await waitFor(() => notifications.some((item) => item.method === 'turn/completed'), 60_000);
  const afterSnapshot = await observer.request('thread/read', { threadId, includeTurns: true });
  expect(JSON.stringify(afterSnapshot)).toContain(threadId);
  expect(JSON.stringify(afterSnapshot)).toContain(turnId);

  /**
   * Refresh the real cN route after the shared turn becomes idle. The project
   * overview does not persist transient isProcessing state, so ownership from
   * the daemon must still be sufficient to reconnect without a false warning.
   */
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('unsafe-codex-handoff-warning')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /Terminal input|消息输入|Message input/i })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'idle-thread-refresh-reconnected.png'), fullPage: true });

  stopRemoteTui(tui);
  closeTransport(observer);
  closeTransport(owner);
  const afterDaemon = JSON.parse(await daemon('version')) as Record<string, unknown>;
  const afterPid = await readDaemonPid();
  expect(beforePid).toBeGreaterThan(0);
  expect(afterPid).toBeGreaterThan(0);
  expect(afterPid).toBe(beforePid);
  const serialized = JSON.stringify(notifications);
  expect(serialized).not.toMatch(/turn\/interrupt|"status":"aborted"/);

  await writeFile(path.join(EVIDENCE_DIR, 'daemon-lifecycle.log'), `${JSON.stringify({ beforePid, afterPid, beforeDaemon, afterDaemon, stopDaemonOnClose: false }, null, 2)}\n`);
  await writeFile(path.join(EVIDENCE_DIR, 'active-turn-continuity.log'), `${JSON.stringify({
    threadId, turnId, beforeSnapshot, ozwSnapshot, afterSnapshot,
    shellInitObserved: shellFrames.some((frame) => frame.includes(threadId)),
    forbiddenEventCount: (serialized.match(/turn\/interrupt|"status":"aborted"/g) || []).length,
    notifications,
  }, null, 2)}\n`);
});

test('未加载的历史空闲线程从会话卡片迁入共享 daemon', async ({ page, request }) => {
  /** 真实私有 app-server 创建线程并退出后，OZW 应由 daemon 只读确认空闲，再用 remote TUI 恢复。 */
  test.setTimeout(90_000);
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const legacyRuntime = await startPrivateAppServer();
  const legacyNotifications: Array<{ method: string; params: unknown }> = [];
  legacyRuntime.transport.onNotification((notification) => legacyNotifications.push(notification));
  const threadResult = await legacyRuntime.transport.request('thread/start', {
    cwd: PRIMARY_FIXTURE_PROJECT_PATH,
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    model: null,
  }) as { thread: { id: string } };
  const threadId = threadResult.thread.id;
  expect(threadId).toBeTruthy();
  await legacyRuntime.transport.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: 'Reply only: historical-idle-ready.', text_elements: [] }],
  });
  await waitFor(() => legacyNotifications.some((notification) => notification.method === 'turn/completed'), 60_000);
  const legacyRead = await legacyRuntime.transport.request('thread/read', { threadId, includeTurns: true });
  expect(JSON.stringify(legacyRead)).toContain('completed');
  await stopPrivateAppServer(legacyRuntime);

  await prepareRealDaemon();
  const observer = createStdioAppServerTransport();
  const beforeLoaded = await observer.request('thread/loaded/list', {});
  expect(JSON.stringify(beforeLoaded)).not.toContain(threadId);
  const beforeRead = await observer.request('thread/read', { threadId, includeTurns: true }) as { thread?: { id?: string; turns?: unknown[] } };
  expect(beforeRead.thread?.id).toBe(threadId);

  const project = await getFixtureProject(request);
  const projectName = String(project.name);
  const projectPath = String(project.fullPath || PRIMARY_FIXTURE_PROJECT_PATH);
  const draftResponse = await request.post(`/api/projects/${encodeURIComponent(projectName)}/manual-sessions`, {
    headers: authHeaders(),
    data: { provider: 'codex', label: '真实历史空闲恢复', projectPath },
  });
  expect(draftResponse.ok()).toBeTruthy();
  const draftPayload = await draftResponse.json() as { session?: { id?: string } };
  const routeSessionId = String(draftPayload.session?.id || '');
  expect(routeSessionId).toMatch(/^c\d+$/);
  await killFixtureTmux(projectPath, routeSessionId);
  const finalizeResponse = await request.post(
    `/api/projects/${encodeURIComponent(projectName)}/manual-sessions/${routeSessionId}/finalize`,
    { headers: authHeaders(), data: { provider: 'codex', actualSessionId: threadId, projectPath } },
  );
  expect(finalizeResponse.ok()).toBeTruthy();

  await authenticatePage(page);
  const routePrefix = String((project as { routePath?: string }).routePath || `/projects/${encodeURIComponent(projectName)}`);
  await page.goto(`${routePrefix}/${routeSessionId}`, { waitUntil: 'networkidle' });
  await page.getByTestId('tab-shell').click();
  await expect(page.getByTestId('unsafe-codex-handoff-warning')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /Terminal input|消息输入|Message input/i })).toBeVisible();
  await waitFor(async () => JSON.stringify(await observer.request('thread/loaded/list', {})).includes(threadId), 20_000);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'historical-idle-thread-migrated.png'), fullPage: true });
  await writeFile(path.join(EVIDENCE_DIR, 'historical-idle-thread-migration.log'), `${JSON.stringify({
    threadId,
    routeSessionId,
    loadedBeforeOpen: false,
    readableBeforeOpen: beforeRead.thread?.id === threadId,
    loadedAfterOpen: true,
  }, null, 2)}\n`);
  closeTransport(observer);
  await killFixtureTmux(projectPath, routeSessionId);
});

test('旧式外部活动会话警告后可由用户强制接入共享 daemon', async ({ page, request }) => {
  /** 默认不抢占；用户确认风险后按原 thread ID 创建受管 tmux 并迁入共享 daemon。 */
  test.setTimeout(120_000);
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const legacyRuntime = await startPrivateAppServer();
  const notifications: Array<{ method: string; params: unknown }> = [];
  legacyRuntime.transport.onNotification((notification) => notifications.push(notification));
  const threadResult = await legacyRuntime.transport.request('thread/start', {
    cwd: PRIMARY_FIXTURE_PROJECT_PATH,
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    model: null,
  }) as { thread: { id: string } };
  const threadId = threadResult.thread.id;
  const turnResult = await legacyRuntime.transport.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: 'Run `sleep 20` in the terminal, then reply only: legacy-active-done.', text_elements: [] }],
  }) as { turn: { id: string } };
  const turnId = turnResult.turn.id;
  await waitFor(async () => {
    const snapshot = await legacyRuntime.transport.request('thread/read', { threadId, includeTurns: true }) as {
      thread?: { path?: string | null };
    };
    const rolloutPath = String(snapshot.thread?.path || '');
    if (!rolloutPath || !/inProgress|active|running/.test(JSON.stringify(snapshot))) return false;
    return (await readFile(rolloutPath).catch(() => Buffer.alloc(0))).length > 0;
  }, 20_000);

  await prepareRealDaemon();
  const observer = createStdioAppServerTransport();
  const sharedRead = await observer.request('thread/read', { threadId, includeTurns: true });
  expect(JSON.stringify(sharedRead)).toContain('interrupted');
  expect(JSON.stringify(sharedRead)).toContain('"completedAt":null');
  expect(JSON.stringify(await observer.request('thread/loaded/list', {}))).not.toContain(threadId);

  const project = await getFixtureProject(request);
  const projectName = String(project.name);
  const projectPath = String(project.fullPath || PRIMARY_FIXTURE_PROJECT_PATH);
  const draftResponse = await request.post(`/api/projects/${encodeURIComponent(projectName)}/manual-sessions`, {
    headers: authHeaders(),
    data: { provider: 'codex', label: '真实旧式活动强制接管', projectPath },
  });
  expect(draftResponse.ok()).toBeTruthy();
  const draftPayload = await draftResponse.json() as { session?: { id?: string } };
  const routeSessionId = String(draftPayload.session?.id || '');
  expect(routeSessionId).toMatch(/^c\d+$/);
  await killFixtureTmux(projectPath, routeSessionId);
  const finalizeResponse = await request.post(
    `/api/projects/${encodeURIComponent(projectName)}/manual-sessions/${routeSessionId}/finalize`,
    { headers: authHeaders(), data: { provider: 'codex', actualSessionId: threadId, projectPath } },
  );
  expect(finalizeResponse.ok()).toBeTruthy();

  const frames: string[] = [];
  const receivedFrames: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => frames.push(String(event.payload)));
    socket.on('framereceived', (event) => receivedFrames.push(String(event.payload)));
  });
  await authenticatePage(page);
  const routePrefix = String((project as { routePath?: string }).routePath || `/projects/${encodeURIComponent(projectName)}`);
  await page.goto(`${routePrefix}/${routeSessionId}`, { waitUntil: 'networkidle' });
  await page.getByTestId('tab-shell').click();
  const warning = page.getByTestId('unsafe-codex-handoff-warning');
  await expect(warning).toContainText(/旧式|无法核实|legacy session|cannot verify/i, { timeout: 20_000 });
  await expect(page.getByTestId('force-codex-handoff')).toBeVisible();
  expect(await fixtureTmuxExists(projectPath, routeSessionId)).toBe(false);
  const afterBlock = await legacyRuntime.transport.request('thread/read', { threadId, includeTurns: true });
  expect(JSON.stringify(afterBlock)).toContain(turnId);
  expect(JSON.stringify(afterBlock)).toMatch(/inProgress|active|running/);
  expect(frames.join('\n')).not.toContain('"forceHandoff":true');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'unsafe-handoff-warning.png'), fullPage: true });

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toMatch(/强制接管|force takeover/i);
    await dialog.accept();
  });
  await page.getByTestId('force-codex-handoff').click();
  await expect(warning).toHaveCount(0, { timeout: 20_000 });
  await waitFor(() => fixtureTmuxExists(projectPath, routeSessionId), 20_000);
  await waitFor(() => receivedFrames.some((frame) => frame.includes('handoff-force-completed')), 20_000);
  const forceCompleted = receivedFrames
    .map((frame) => { try { return JSON.parse(frame) as Record<string, unknown>; } catch { return null; } })
    .find((frame) => frame?.type === 'handoff-force-completed');
  const sharedThreadId = String(forceCompleted?.providerSessionId || '');
  expect(sharedThreadId).toBeTruthy();
  expect(sharedThreadId).not.toBe(threadId);
  const routeIndex = Number(routeSessionId.replace(/^c/, ''));
  let sharedBindingFound = false;
  await waitFor(async () => {
    const response = await request.get('/api/codex/sessions', {
      headers: authHeaders(),
      params: { projectPath },
    });
    const payload = await response.json() as { sessions?: Array<{ routeIndex?: number; providerSessionId?: string }> };
    sharedBindingFound = payload.sessions?.some(
      (session) => session.routeIndex === routeIndex && session.providerSessionId === sharedThreadId,
    ) === true;
    return sharedBindingFound;
  }, 20_000);
  const legacyAfterHandoff = await legacyRuntime.transport.request('thread/read', { threadId, includeTurns: true });
  expect(JSON.stringify(legacyAfterHandoff)).toContain(turnId);
  expect(frames.join('\n')).toContain('"forceHandoff":true');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'forced-handoff-connected.png'), fullPage: true });

  await waitFor(() => notifications.some((notification) => notification.method === 'turn/completed'), 60_000);
  await writeFile(path.join(EVIDENCE_DIR, 'forced-handoff-network.json'), `${JSON.stringify({
    legacyThreadId: threadId,
    sharedThreadId,
    turnId,
    routeSessionId,
    managedTmuxCreated: await fixtureTmuxExists(projectPath, routeSessionId),
    sharedThreadCaptured: true,
    sharedThreadBoundToCard: sharedBindingFound,
    legacyProcessPreserved: JSON.stringify(legacyAfterHandoff).includes(turnId),
    browserFrames: frames,
    browserReceivedFrames: receivedFrames,
    notifications,
  }, null, 2)}\n`);
  closeTransport(observer);
  await stopPrivateAppServer(legacyRuntime);
  await killFixtureTmux(projectPath, routeSessionId);
});

declare global {
  interface Window { openSettings?: (tab?: string) => void }
}
