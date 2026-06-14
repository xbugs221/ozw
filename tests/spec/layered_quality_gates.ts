/**
 * 文件目的：锁定 ozw 分层质量门和耗时基线的长期规格。
 * 业务场景：开发者需要按改动风险选择 fast、smoke、full，并保留可复查的测试耗时数据。
 * 失败含义：失败通常意味着默认测试缩水、质量门入口分叉，或耗时证据无法复核。
 * Sources: 2026-06-06-86-建立分层质量门和耗时基线
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

type PackageJson = { scripts?: Record<string, string> };

/**
 * Read repository text by relative path.
 */
async function readText(relativePath: string): Promise<string> {
  try {
    return await fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      assert.fail(`${relativePath} 不存在，分层质量门必须提供对应脚本或文档`);
    }
    throw error;
  }
}

test('package exposes fast, smoke, full, and timing quality gates', async () => {
  const packageJson = JSON.parse(await readText('package.json')) as PackageJson;
  const scripts = packageJson.scripts ?? {};

  // 业务场景：开发者要能按风险选择测试范围，而不是每次都跑单一全量链路。
  assert.match(scripts['test:fast'] ?? '', /typecheck/);
  assert.match(scripts['test:fast'] ?? '', /test:vitest/);
  assert.match(scripts['test:fast'] ?? '', /test:server:smoke/);
  assert.doesNotMatch(scripts['test:fast'] ?? '', /test:e2e(?!:smoke)/);
  assert.match(scripts['test:smoke'] ?? '', /test:fast/);
  assert.match(scripts['test:smoke'] ?? '', /test:e2e:smoke/);
  assert.match(scripts['test:full'] ?? '', /typecheck/);
  assert.match(scripts['test:full'] ?? '', /test:vitest/);
  assert.match(scripts['test:full'] ?? '', /test:node/);
  assert.match(scripts['test:full'] ?? '', /test:browser:full/);
  assert.equal(scripts.test, 'pnpm run test:full');
  assert.equal(scripts['qa:test:timing'], 'tsx scripts/collect-test-timings.ts');
});

test('timing script records commands, durations, and exit codes', async () => {
  const timingScript = await readText('scripts/collect-test-timings.ts');

  // 失败含义：耗时基线必须来自真实命令执行，不能硬编码成功或只打印说明。
  assert.match(timingScript, /spawn|execFile/);
  assert.match(timingScript, /durationMs/);
  assert.match(timingScript, /exitCode/);
  assert.match(timingScript, /test-results\/test-performance\/latest\.json/);
  assert.doesNotMatch(timingScript, /exitCode:\s*0\s*[,}]/, '耗时脚本不应硬编码成功退出码');
});

test('performance guide explains when to use each quality gate', async () => {
  const guide = await readText('docs/testing-performance.md');

  // 业务场景：非专业审阅者和后续维护者需要知道效率入口对应的业务风险。
  for (const term of ['test:fast', 'test:smoke', 'test:full', 'qa:test:timing']) {
    assert.match(guide, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(guide, /本地|日常/);
  assert.match(guide, /提交|合并|发布/);
  assert.match(guide, /耗时|基线/);
  assert.match(guide, /Playwright|浏览器/);
});
