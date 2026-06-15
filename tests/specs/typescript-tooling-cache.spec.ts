/**
 * Sources: 2026-06-06-82-优化TypeScript增量编译缓存
 *
 * 文件目的：稳定验证 TypeScript 工具链按 web/node/test 边界拆分，并把增量缓存写入不会进入提交的目录。
 * 业务场景：开发者需要单独检查改动边界，同时发布构建仍由 tsc 产出 dist-node 后端入口。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const CACHE_ROOT = '.tmp/tsbuildinfo';
const TYPECHECK_CONFIGS = [
  ['tsconfig.web.json', 'web'],
  ['tsconfig.node.json', 'node'],
  ['tsconfig.test.json', 'test'],
  ['tsconfig.build.json', 'build'],
] as const;

type PackageJson = { scripts?: Record<string, string> };
type TsConfig = { compilerOptions?: Record<string, unknown> };

/**
 * Read a repository file as UTF-8 text for tooling contract checks.
 */
async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Read a JSON repository file and return the parsed object.
 */
async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readText(relativePath)) as T;
}

test('TypeScript checks are split by source boundary while root typecheck keeps full coverage', async () => {
  /**
   * Verify the scripts real developers run from package.json rather than a local
   * helper, because the business contract is CLI behavior at the repository root.
   */
  const packageJson = await readJson<PackageJson>('package.json');
  const scripts = packageJson.scripts ?? {};

  assert.equal(scripts['typecheck:web'], 'tsc -p tsconfig.web.json --noEmit');
  assert.equal(scripts['typecheck:node'], 'tsc -p tsconfig.node.json --noEmit');
  assert.equal(scripts['typecheck:test'], 'tsc -p tsconfig.test.json --noEmit');
  assert.match(scripts.typecheck ?? '', /typecheck:web/);
  assert.match(scripts.typecheck ?? '', /typecheck:node/);
  assert.match(scripts.typecheck ?? '', /typecheck:test/);
});

test('TypeScript incremental caches are explicit and ignored by git', async () => {
  /**
   * Confirm every TypeScript boundary writes cache files to the same ignored
   * root, so repeated checks can reuse them without polluting commits.
   */
  const gitignore = await readText('.gitignore');

  assert.match(gitignore, /^\.tmp\/?$/m, '.tmp/ must be ignored by git');

  for (const [configPath, cacheName] of TYPECHECK_CONFIGS) {
    const config = await readJson<TsConfig>(configPath);
    const options = config.compilerOptions ?? {};
    assert.equal(options.incremental, true, `${configPath} must enable incremental`);
    assert.equal(
      options.tsBuildInfoFile,
      `${CACHE_ROOT}/${cacheName}.tsbuildinfo`,
      `${configPath} must write tsbuildinfo into ${CACHE_ROOT}`,
    );
  }
});

test('server build remains a tsc build that emits dist-node', async () => {
  /**
   * Guard the release path: faster type checks must not replace the server build
   * with a no-emit check or runtime-only transpilation.
   */
  const packageJson = await readJson<PackageJson>('package.json');
  const buildConfig = await readJson<TsConfig>('tsconfig.build.json');
  const options = buildConfig.compilerOptions ?? {};

  assert.match(packageJson.scripts?.['build:server'] ?? '', /^tsc -p tsconfig\.build\.json\b/);
  assert.match(packageJson.scripts?.['build:server'] ?? '', /copy-build-runtime-js\.mjs/);
  assert.equal(options.noEmit, false);
  assert.equal(options.outDir, 'dist-node');
});
