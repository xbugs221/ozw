/**
 * 文件目的：验证 package.json 默认测试入口保持完整质量门语义。
 * 业务场景：开发者运行 pnpm test 时应得到完整保护，同时可通过 test:full 复用同一质量门。
 */
import { describe, it } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const pkgPath = resolve(REPO_ROOT, 'package.json');

interface PackageJson {
  scripts?: Record<string, string>;
}

function loadScripts(): Record<string, string> {
  /**
   * Load package scripts from the real repository root for CLI contract checks.
   */
  const raw = readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw) as PackageJson;
  if (!pkg.scripts) throw new Error('package.json 缺少 scripts 字段');
  return pkg.scripts;
}

describe('pnpm test 全量入口', () => {
  it('test 脚本委托 test:full，避免默认全量入口和分层质量门分叉', () => {
    const scripts = loadScripts();
    ok(scripts.test, 'package.json 缺少 test 脚本');
    strictEqual(scripts.test, 'pnpm run test:full');
    ok(scripts['test:full']?.includes('pnpm run typecheck'), 'test:full 应包含 typecheck');
    ok(scripts['test:full']?.includes('pnpm run test:node'), 'test:full 应包含完整 Node 回归');
    ok(scripts['test:full']?.includes('pnpm run test:browser:full'), 'test:full 应包含完整浏览器回归');
  });

  it('test:spec 覆盖 node 和 browser spec', () => {
    const scripts = loadScripts();
    ok(scripts['test:spec'], 'package.json 缺少 test:spec 脚本');
    ok(scripts['test:spec'].includes('test:spec:node'), 'test:spec 应包含 test:spec:node');
    ok(scripts['test:spec'].includes('test:spec:browser'), 'test:spec 应包含 test:spec:browser');
  });

  it('test:full 命令顺序正确：先类型检查，再 Vitest、Node、Browser', () => {
    const scripts = loadScripts();
    const full = scripts['test:full'] ?? '';
    const idxTypecheck = full.indexOf('typecheck');
    const idxVitest = full.indexOf('test:vitest');
    const idxNode = full.indexOf('test:node');
    const idxBrowser = full.indexOf('test:browser:full');

    ok(idxTypecheck >= 0, 'test:full 应包含 typecheck');
    ok(idxVitest >= 0, 'test:full 应包含 test:vitest');
    ok(idxNode >= 0, 'test:full 应包含 test:node');
    ok(idxBrowser >= 0, 'test:full 应包含 test:browser:full');
    ok(idxTypecheck < idxVitest, 'typecheck 应在 test:vitest 之前');
    ok(idxVitest < idxNode, 'test:vitest 应在 test:node 之前');
    ok(idxNode < idxBrowser, 'test:node 应在 test:browser:full 之前');
  });

  it('细分测试脚本仍保留', () => {
    const scripts = loadScripts();
    ok(scripts['test:server'], 'test:server 脚本应保留');
    ok(scripts['test:e2e'], 'test:e2e 脚本应保留');
    ok(scripts['test:spec:node'], 'test:spec:node 脚本应保留');
    ok(scripts['test:spec:browser'], 'test:spec:browser 脚本应保留');
  });

  it('不存在 test.skip 或条件跳过入口', () => {
    const scripts = loadScripts();
    const skipScripts = Object.keys(scripts).filter(
      (k) => k.includes('.skip') || k.includes('_skip') || k.includes('.conditional')
    );
    strictEqual(skipScripts.length, 0, `不应存在 skip 脚本: ${skipScripts.join(', ')}`);
  });
});
