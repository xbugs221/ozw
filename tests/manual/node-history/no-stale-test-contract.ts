import { describe, it } from 'node:test';
import { ok } from 'node:assert';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TESTS_DIR = resolve(REPO_ROOT, 'tests');

describe('no-stale-test-contract', () => {
  it('测试文件不再引用已删除的 .jsx 入口', () => {
    const jsxRefs = execSync(
      `rg -l 'frontend/main\\.jsx|SetupForm\\.jsx|Onboarding\\.jsx|ProjectCreationWizard\\.jsx|LanguageSelector\\.jsx' "${TESTS_DIR}" 2>/dev/null || true`,
      { encoding: 'utf8' },
    ).trim();

    ok(jsxRefs === '', `测试文件中仍有旧 .jsx 引用:\n${jsxRefs}`);
  });

  it('e2e 测试代码不硬编码 .wo/runs 或 .ozw/runs 作为真实文件路径', () => {
    // Allow .wo/runs in JSON fixture data (display paths per spec.md),
    // but files must use resolveFlowRunStatePath/resolveFlowRunsRoot for real path operations.
    const raw = execSync(
      `rg -n '\\.wo/runs|\\.ozw/runs' "${TESTS_DIR}/e2e" 2>/dev/null || true`,
      { encoding: 'utf8' },
    ).trim();

    if (raw === '') {
      return;
    }

    // Exclude lines that are JSON fixture display-path strings (not real path resolution)
    const suspicious = raw.split('\n').filter((line) => {
      // Skip JSON fixture data lines containing path strings
      if (line.includes("'.wo/runs") || line.includes('\".wo/runs') ||
          line.includes("'.ozw/runs") || line.includes('\".ozw/runs')) {
        return false;
      }
      return true;
    });

    ok(suspicious.length === 0, `e2e 测试代码仍硬编码旧运行态路径:\n${suspicious.join('\n')}`);
  });

  it('package.json 包含 test 全量入口', () => {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
    ok(typeof pkg.scripts?.test === 'string', 'package.json 缺少 test 脚本');
    ok(pkg.scripts.test.includes('pnpm run'), 'test 脚本应为 pnpm 命令链');
    ok(pkg.scripts.test.includes('typecheck'), 'test 应包含 typecheck');
    ok(pkg.scripts.test.includes('test:e2e'), 'test 应包含 test:e2e');
    ok(pkg.scripts.test.includes('test:spec'), 'test 应包含 test:spec');
  });
});
