/**
 * 文件目的：自举隔离的真实 Codex daemon，并用真实浏览器和官方远端终端验证无损接管。
 * 业务意义：验收无需人工注入会话编号，且所有要求的运行证据都由同一次真实执行产生。
 */
import { expect, test } from '@playwright/test';
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createStdioAppServerTransport, type CodexAppServerTransport } from '../../backend/domains/codex-app-server/stdio-transport.ts';
import { writeCodexDaemonNetworkState } from '../../backend/domains/codex-app-server/daemon-network-policy.ts';
import {
  authHeaders,
  authenticatePage,
  getFixtureProject,
  openFixtureProject,
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
async function prepareRealDaemon(): Promise<Record<string, unknown>> {
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
  await daemon('enable-remote-control');
  await daemon('start');
  daemonStartedByTest = true;
  return JSON.parse(await daemon('version')) as Record<string, unknown>;
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

  const diagnosticsResponse = await request.get('/api/diagnostics/codex-shared-runtime', { headers: authHeaders() });
  const diagnostics = await diagnosticsResponse.json() as { network?: { fingerprint?: string } };
  writeCodexDaemonNetworkState(CODEX_HOME, {
    appliedFingerprint: 'previous-network-fingerprint',
    pendingFingerprint: diagnostics.network?.fingerprint || null,
  });
  await page.evaluate(() => window.openSettings?.('diagnostics'));
  await expect(page.getByTestId('codex-runtime-mode')).toContainText('shared-daemon', { timeout: 30_000 });
  await expect(page.getByTestId('codex-proxy-restart-warning')).toContainText(/活动会话|active turn/i);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'proxy-restart-warning.png'), fullPage: true });

  await waitFor(() => notifications.some((item) => item.method === 'turn/completed'), 60_000);
  const afterSnapshot = await observer.request('thread/read', { threadId, includeTurns: true });
  expect(JSON.stringify(afterSnapshot)).toContain(threadId);
  expect(JSON.stringify(afterSnapshot)).toContain(turnId);
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

test('旧式外部活动会话显示安全阻止且没有发送接管请求', async ({ page }) => {
  test.setTimeout(60_000);
  await daemon('stop');
  daemonStartedByTest = false;
  const frames: string[] = [];
  page.on('websocket', (socket) => socket.on('framesent', (event) => frames.push(String(event.payload))));
  await openFixtureProject(page);
  await page.goto('/workspace/fixture-project/c3', { waitUntil: 'networkidle' });
  await page.getByTestId('tab-shell').click();
  await expect(page.getByTestId('unsafe-codex-handoff-warning')).toContainText('正在运行', { timeout: 20_000 });
  const serialized = frames.join('\n');
  expect(serialized).not.toMatch(/codex resume|turn\/interrupt|turn\/start/);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'unsafe-handoff-blocked.png'), fullPage: true });
  await writeFile(path.join(EVIDENCE_DIR, 'unsafe-handoff-network.json'), `${JSON.stringify(frames, null, 2)}\n`);
});

declare global {
  interface Window { openSettings?: (tab?: string) => void }
}
