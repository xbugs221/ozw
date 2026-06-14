/**
 * Sources: 2026-06-06-83-迁移低状态Node测试到Vitest
 *
 * 文件目的：稳定验证 Vitest 快速层覆盖足够真实低状态业务模块，同时不吞入后端运行态或浏览器测试。
 * 业务场景：开发者希望快速运行纯业务逻辑回归，但服务端和浏览器长链路仍留在各自入口。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const UNIT_DIR = 'tests/unit';
const HIGH_STATE_PATTERNS = [
  /\blisten\s*\(/,
  /\bWebSocket\b/,
  /\bbetter-sqlite3\b/,
  /\bchild_process\b/,
  /process\.env\.HOME/,
  /process\.env\.XDG_STATE_HOME/,
  /@playwright\/test/,
] as const;

type PackageJson = { scripts?: Record<string, string> };

test('Vitest quick layer keeps broad low-state business coverage without replacing server regression', async () => {
  /**
   * Verify the user-facing test commands and the real tests/unit inventory.
   * The contract is about repository behavior, so this scans package scripts and
   * test sources rather than checking one implementation helper.
   */
  const packageJson = JSON.parse(await readText('package.json')) as PackageJson;
  const scripts = packageJson.scripts ?? {};
  const testFiles = (await collectFiles(UNIT_DIR)).filter((filePath) => filePath.endsWith('.test.ts'));
  const importedRoots = new Set<string>();

  assert.match(scripts['test:vitest'] ?? '', /vitest/);
  assert.equal(scripts['test:server'], 'tsx --test tests/backend/*.test.ts');
  assert.ok(testFiles.length >= 5, `tests/unit 至少需要 5 个 Vitest 业务测试，当前只有 ${testFiles.length} 个`);

  for (const filePath of testFiles) {
    const source = await readText(filePath);
    assert.match(source, /from ['"]vitest['"]/, `${filePath} 必须使用 Vitest API`);
    for (const root of collectImportedSourceRoots(source)) {
      importedRoots.add(root);
    }
    for (const pattern of HIGH_STATE_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${filePath} 包含高状态运行态模式 ${pattern}`);
    }
  }

  assert.ok(
    importedRoots.size >= 2,
    `tests/unit 必须覆盖至少两个源码根，当前只有: ${[...importedRoots].join(', ') || '无'}`,
  );
});

async function readText(relativePath: string): Promise<string> {
  /**
   * Read a repository-relative file for contract assertions.
   */
  return fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

async function collectFiles(relativeDir: string): Promise<string[]> {
  /**
   * Recursively collect repository files from a test classification directory.
   */
  const absoluteDir = path.join(REPO_ROOT, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) return collectFiles(relativePath);
    return [relativePath];
  }));
  return files.flat().sort();
}

function collectImportedSourceRoots(source: string): Set<string> {
  /**
   * Return first-level business source roots imported by a Vitest test file.
   */
  const roots = new Set<string>();
  const importPattern = /from\s+['"](?:\.\.\/)+(backend|frontend|shared)\//g;
  for (const match of source.matchAll(importPattern)) {
    roots.add(match[1]);
  }
  return roots;
}
