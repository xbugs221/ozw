import { describe, it } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const pkgPath = resolve(REPO_ROOT, 'package.json');

interface PackageJson {
  scripts?: Record<string, string>;
}

function loadScripts(): Record<string, string> {
  const raw = readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw) as PackageJson;
  if (!pkg.scripts) throw new Error('package.json 缺少 scripts 字段');
  return pkg.scripts;
}

describe('pnpm test 全量入口', () => {
  it('test 脚本覆盖 typecheck、test:server、test:spec 和 test:e2e', () => {
    const scripts = loadScripts();
    ok(scripts.test, 'package.json 缺少 test 脚本');
    ok(scripts.test.includes('pnpm run typecheck'), 'test 应包含 typecheck');
    ok(scripts.test.includes('pnpm run test:server'), 'test 应包含 test:server');
    ok(scripts.test.includes('pnpm run test:spec'), 'test 应包含 test:spec');
    ok(scripts.test.includes('pnpm run test:e2e'), 'test 应包含 test:e2e');
  });

  it('test:spec 覆盖 node 和 browser spec', () => {
    const scripts = loadScripts();
    ok(scripts['test:spec'], 'package.json 缺少 test:spec 脚本');
    ok(scripts['test:spec'].includes('test:spec:node'), 'test:spec 应包含 test:spec:node');
    ok(scripts['test:spec'].includes('test:spec:browser'), 'test:spec 应包含 test:spec:browser');
  });

  it('test 命令顺序正确：先类型检查，再 server、spec、e2e', () => {
    const scripts = loadScripts();
    const idxTypecheck = scripts.test.indexOf('typecheck');
    const idxServer = scripts.test.indexOf('test:server');
    const idxSpec = scripts.test.indexOf('test:spec');
    const idxE2e = scripts.test.indexOf('test:e2e');

    ok(idxTypecheck < idxServer, 'typecheck 应在 test:server 之前');
    ok(idxServer < idxSpec, 'test:server 应在 test:spec 之前');
    ok(idxSpec < idxE2e, 'test:spec 应在 test:e2e 之前');
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
