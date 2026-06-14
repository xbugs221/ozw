import { describe, it } from 'node:test';
import { ok } from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const TESTS_DIR = resolve(REPO_ROOT, 'tests');

const DELETED_TEST_PATHS = [
  '2026-05-09-1-适配wo-oz并展示新版工作流输出-wo-workflow-contract.test.ts',
  '2026-05-09-2-修正项目列表和wo进度展示-wo-workflow-contract.test.ts',
  '2026-05-10-5-统一外部依赖发现和诊断-co-client.test.ts',
  '2026-05-10-5-统一外部依赖发现和诊断-runtime-dependencies.test.ts',
  '2026-05-09-2-修正项目列表和wo进度展示-project-discovery-temp-projects.test.ts',
  '2026-05-12-18-简化wo状态详情并移除会话小地图-placeholder.test.ts',
];

describe('canonical-tests-contract', () => {
  it('已删除的重复测试不再存在', () => {
    const stillExisting = DELETED_TEST_PATHS.filter((p) =>
      existsSync(resolve(TESTS_DIR, p)),
    );

    ok(
      stillExisting.length === 0,
      `以下重复测试应已删除但依然存在:\n${stillExisting.map((p) => `  - tests/${p}`).join('\n')}`,
    );
  });

  it('canonical backend 测试仍然存在', () => {
    const serverTests = [
      'wo-workflow-contract.test.ts',
      'runtime-dependencies.test.ts',
      'project-discovery-temp-projects.test.ts',
    ];

    for (const testFile of serverTests) {
      ok(
        existsSync(resolve(TESTS_DIR, 'backend', testFile)),
        `tests/backend/${testFile} 必须保留为 canonical 测试`,
      );
    }
  });

  it('根目录 tests 不包含其他重复副本', () => {
    const shouldNotExist = ['wo-workflow-contract.test.ts'];
    for (const name of shouldNotExist) {
      ok(
        !existsSync(resolve(TESTS_DIR, name)),
        `tests/${name} 不应存在于根目录 (已有 tests/backend 版本)`,
      );
    }
  });
});
