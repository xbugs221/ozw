/**
 * PURPOSE: 契约测试，约束前端项目状态 hook 拆成可测试业务模块。
 *
 * 业务意义：项目选择、会话路由和刷新 merge 共同决定用户打开哪个工作区和会话，
 * 这些规则必须脱离单个大型 React hook，便于审查和回归。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const RESULT_DIR = path.join(REPO_ROOT, 'test-results/15-project-state-hook-split');

/**
 * 读取源码文件。
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 写入 hook 拆分审计快照。
 */
async function writeAudit(snapshot: unknown): Promise<void> {
  await mkdir(RESULT_DIR, { recursive: true });
  await writeFile(path.join(RESULT_DIR, 'source-audit.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

test('useProjectsState 拆出项目路由、会话集合和刷新 reducer', async () => {
  const hookPath = 'frontend/hooks/useProjectsState.ts';
  const hookSource = await readRepoFile(hookPath);
  const requiredModules = [
    'frontend/hooks/projects/projectRouteSelection.ts',
    'frontend/hooks/projects/projectSessionCollections.ts',
    'frontend/hooks/projects/projectRefreshReducer.ts',
  ];
  const snapshot = {
    hookLineCount: hookSource.split(/\r?\n/).length,
    modules: requiredModules.map((modulePath) => ({
      path: modulePath,
      exists: existsSync(path.join(REPO_ROOT, modulePath)),
      importedByHook: hookSource.includes(`./projects/${path.basename(modulePath, '.ts')}`),
    })),
    legacyRouteRegexCount: (hookSource.match(/\/session\/\(\[\^\/\]\+\)|\/session\/\(\[\^\/\]\+\)|\^\\\/session\\\//g) || []).length,
  };

  await writeAudit(snapshot);

  assert.ok(snapshot.hookLineCount <= 950, `useProjectsState.ts 应收敛为组合 hook，当前 ${snapshot.hookLineCount} 行`);
  for (const module of snapshot.modules) {
    assert.equal(module.exists, true, `${module.path} 必须存在`);
    assert.equal(module.importedByHook, true, `useProjectsState.ts 必须导入 ${module.path}`);
  }
});

test('拆分模块导出真实业务入口', async () => {
  const expectedExports = [
    ['frontend/hooks/projects/projectRouteSelection.ts', ['resolveRouteSelection', 'findWorkflowChildSessionForRoute']],
    ['frontend/hooks/projects/projectSessionCollections.ts', ['getProjectSessions', 'insertSessionIntoProject']],
    ['frontend/hooks/projects/projectRefreshReducer.ts', ['mergeProjectOverview', 'mergeProjectSummaries']],
  ] as const;

  for (const [modulePath, exports] of expectedExports) {
    assert.equal(existsSync(path.join(REPO_ROOT, modulePath)), true, `${modulePath} 必须存在`);
    const source = await readRepoFile(modulePath);
    assert.match(source, /PURPOSE|目的|project|session|route|refresh/i, `${modulePath} 必须说明业务目的`);
    for (const exportName of exports) {
      assert.match(source, new RegExp(`export\\s+(function|const)\\s+${exportName}\\b`), `${modulePath} 必须导出 ${exportName}`);
    }
  }
});
