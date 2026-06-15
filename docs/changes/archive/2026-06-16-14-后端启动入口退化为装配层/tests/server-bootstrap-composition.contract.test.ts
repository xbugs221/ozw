/**
 * PURPOSE: 契约测试，约束后端 server bootstrap 只能承担装配和生命周期职责。
 *
 * 业务意义：后端启动入口越大，调整 HTTP API、WebSocket 或诊断路径时越容易误伤
 * unrelated runtime 行为。本测试用真实源码约束边界。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const RESULT_DIR = path.join(REPO_ROOT, 'test-results/14-server-bootstrap-composition');

/**
 * 读取仓库源码。
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 统计 Express route 直接注册数量。
 */
function countDirectRoutes(source: string): number {
  return (source.match(/\bapp\.(get|post|put|delete|patch)\(/g) || []).length;
}

/**
 * 写入源码审计快照，供人工复核。
 */
async function writeAudit(snapshot: unknown): Promise<void> {
  await mkdir(RESULT_DIR, { recursive: true });
  await writeFile(path.join(RESULT_DIR, 'source-audit.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

test('server-bootstrap 不再直接拥有业务 HTTP route', async () => {
  const bootstrap = await readRepoFile('backend/server/server-bootstrap.ts');
  const systemRoutesPath = 'backend/server/http/system-routes.ts';
  const snapshot = {
    lineCount: bootstrap.split(/\r?\n/).length,
    directRouteCount: countDirectRoutes(bootstrap),
    hasSystemRoutesModule: existsSync(path.join(REPO_ROOT, systemRoutesPath)),
    hasSystemUpdateInBootstrap: bootstrap.includes('/api/system/update'),
  };

  await writeAudit(snapshot);

  assert.ok(snapshot.lineCount <= 1300, `server-bootstrap.ts 应继续收敛为装配层，当前 ${snapshot.lineCount} 行`);
  assert.equal(snapshot.directRouteCount, 0, 'server-bootstrap.ts 不得直接注册 Express 业务 route');
  assert.equal(snapshot.hasSystemRoutesModule, true, 'system update 必须位于 backend/server/http/system-routes.ts');
  assert.equal(snapshot.hasSystemUpdateInBootstrap, false, '/api/system/update 不得继续留在 bootstrap 中');
});

test('WebSocket path 分派进入独立 gateway 模块', async () => {
  const bootstrap = await readRepoFile('backend/server/server-bootstrap.ts');
  const gatewayPath = 'backend/server/websocket-gateway.ts';
  assert.equal(existsSync(path.join(REPO_ROOT, gatewayPath)), true, '必须存在 WebSocket gateway 边界模块');

  const gateway = await readRepoFile(gatewayPath);
  assert.match(gateway, /handleChatConnection/, 'gateway 必须继续分派 chat WebSocket handler');
  assert.match(gateway, /handleShellConnection/, 'gateway 必须继续分派 shell WebSocket handler');
  assert.match(gateway, /authenticateWebSocket|getWebSocketAuthToken/, 'gateway 必须显式保留 WebSocket 认证边界');
  assert.ok(!/new WebSocketServer|pathname|Unknown WebSocket path/.test(bootstrap), 'WebSocket path 分派主体不得继续留在 bootstrap');
});
