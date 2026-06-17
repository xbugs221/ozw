/**
 * 文件目的：锁定后端启动、聊天 realtime 和文件 API 边界的重构目标。
 * 业务风险：启动装配、协议分发和文件访问规则若继续混在巨型文件中，安全边界和实时会话归属会难以审查。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = process.cwd();

const BOUNDARY_BUDGETS = [
  { path: 'backend/server/server-bootstrap.ts', maxLines: 900 },
  { path: 'backend/server/realtime/chat-command-dispatcher.ts', maxLines: 520 },
  { path: 'backend/server/file-routes.ts', maxLines: 520 },
] as const;

const REQUIRED_BACKEND_MODULES = [
  {
    path: 'backend/server/realtime/chat-client-scope-store.ts',
    exports: ['createChatClientScopeStore', 'normalizeChatClientScope'],
  },
  {
    path: 'backend/server/realtime/chat-command-router.ts',
    exports: ['dispatchChatCommand', 'buildChatCommandContext'],
  },
  {
    path: 'backend/server/files/file-route-helpers.ts',
    exports: ['shouldSkipProjectTreeEntry', 'permissionBitsToRwx', 'expandWorkspacePath'],
  },
  {
    path: 'backend/server/files/file-tree-routes.ts',
    exports: ['registerFileTreeRoutes'],
  },
  {
    path: 'backend/server/files/file-mutation-routes.ts',
    exports: ['registerFileMutationRoutes'],
  },
  {
    path: 'backend/server/files/file-download-routes.ts',
    exports: ['registerFileDownloadRoutes'],
  },
] as const;

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * 读取后端源码，验证重构后启动和路由文件是否退回装配层。
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

function countLines(source: string): number {
  /**
   * 用行数预算约束高风险后端边界文件。
   */
  return source.split(/\r?\n/).length;
}

test('P1 backend server bootstrap, chat dispatcher, and file routes delegate focused modules', async () => {
  for (const budget of BOUNDARY_BUDGETS) {
    const source = await readRepoFile(budget.path);
    assert.ok(countLines(source) <= budget.maxLines, `${budget.path} 必须不超过 ${budget.maxLines} 行，当前 ${countLines(source)} 行`);
  }

  const combinedBoundarySource = await Promise.all(BOUNDARY_BUDGETS.map((budget) => readRepoFile(budget.path))).then((parts) => parts.join('\n'));
  for (const module of REQUIRED_BACKEND_MODULES) {
    assert.equal(existsSync(path.join(REPO_ROOT, module.path)), true, `${module.path} 必须存在`);
    const source = await readRepoFile(module.path);
    assert.match(source, /PURPOSE|目的|server|chat|file|route|scope/i, `${module.path} 必须说明业务目的`);
    for (const exportName of module.exports) {
      assert.match(source, new RegExp(`export\\s+(function|const)\\s+${exportName}\\b`), `${module.path} 必须导出 ${exportName}`);
      assert.match(combinedBoundarySource, new RegExp(`\\b${exportName}\\b`), `后端边界文件必须组合使用 ${exportName}`);
    }
  }

  const bootstrapSource = await readRepoFile('backend/server/server-bootstrap.ts');
  assert.doesNotMatch(bootstrapSource, /function\s+classifyProjectFile\b/, '文件分类必须迁出 server-bootstrap.ts');
  assert.doesNotMatch(bootstrapSource, /function\s+acceptChatRequestId\b/, 'chat request id 去重必须迁出 server-bootstrap.ts');
  assert.doesNotMatch(bootstrapSource, /function\s+extractUrlsFromText\b/, 'shell URL 解析必须迁出 server-bootstrap.ts');
});
