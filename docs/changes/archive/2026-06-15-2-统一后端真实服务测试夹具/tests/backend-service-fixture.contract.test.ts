/**
 * PURPOSE: 约束真实后端服务测试必须复用共享 fixture，避免认证、
 * DATABASE_PATH 和 WebSocket token 传递逻辑在多个测试里重复漂移。
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('../../../../', import.meta.url).pathname);
const HELPER_PATH = 'tests/backend/helpers/backend-service-fixture.ts';
const MIGRATED_TESTS = [
  'tests/backend/co-idle-status.test.ts',
  'tests/backend/pi-websocket-behavior.test.ts',
  'tests/backend/pi-cli-diagnostics.test.ts',
];

async function readRepoText(relativePath: string): Promise<string> {
  /**
   * PURPOSE: 从仓库根读取真实源码，确保测试约束的是当前工程结构。
   */
  return fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('共享 fixture 暴露真实 server 测试所需入口并隔离子进程环境', async () => {
  /**
   * 业务场景：新增真实后端测试时，开发者只调用 helper，不复制启动样板。
   */
  const helperSource = await readRepoText(HELPER_PATH);

  assert.match(helperSource, /export\s+async\s+function\s+startIsolatedBackendServer/);
  assert.match(helperSource, /export\s+async\s+function\s+registerTestUser/);
  assert.match(helperSource, /export\s+async\s+function\s+openAuthenticatedWebSocket/);
  assert.match(helperSource, /export\s+async\s+function\s+stopBackendServerFixture/);
  assert.match(helperSource, /DATABASE_PATH/);
  assert.match(helperSource, /JWT_SECRET/);
  assert.match(helperSource, /HOST:\s*['"]127\.0\.0\.1['"]/);
  assert.match(helperSource, /SESSION_PATH_SCAN_INTERVAL_MS/);
  assert.match(helperSource, /authorization:\s*`Bearer \$\{token\}`|authorization:\s*['"]Bearer /);
  assert.doesNotMatch(helperSource, /\/ws\?token=/);
});

test('重复真实 server 测试迁移到共享 fixture', async () => {
  /**
   * 业务场景：认证方式或临时 DB 策略变化时，只需改 helper 即可覆盖这些测试。
   */
  const audit: Record<string, { importsHelper: boolean; directSpawn: boolean; queryToken: boolean }> = {};

  for (const relativePath of MIGRATED_TESTS) {
    const source = await readRepoText(relativePath);
    audit[relativePath] = {
      importsHelper: source.includes('backend-service-fixture'),
      directSpawn: /spawn\(process\.execPath,\s*\[TSX_CLI,\s*['"]backend\/index\.ts['"]\]/.test(source),
      queryToken: /\/ws\?token=/.test(source),
    };

    assert.equal(audit[relativePath].importsHelper, true, `${relativePath} 必须导入共享 fixture`);
    assert.equal(audit[relativePath].directSpawn, false, `${relativePath} 不得直接 spawn backend/index.ts`);
    assert.equal(audit[relativePath].queryToken, false, `${relativePath} 不得使用 URL query token`);
  }

  await fs.mkdir(path.join(REPO_ROOT, 'test-results/backend-service-fixture'), { recursive: true });
  await fs.writeFile(
    path.join(REPO_ROOT, 'test-results/backend-service-fixture/source-audit.json'),
    JSON.stringify(audit, null, 2),
    'utf8',
  );
});
