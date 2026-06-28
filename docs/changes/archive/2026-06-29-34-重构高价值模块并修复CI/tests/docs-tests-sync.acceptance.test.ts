/**
 * PURPOSE: Contract-test durable docs and default tests so high-value refactor
 * and CI fixes survive beyond the proposal-local tests.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_PATH = path.join(REPO_ROOT, 'test-results/high-value-refactor/docs-tests-sync.json');

const REQUIRED_PATHS = [
  {
    path: 'docs/specs/high-value-module-refactor.md',
    purpose: '高价值模块重构 durable spec',
  },
  {
    path: 'tests/specs/high-value-module-refactor.spec.ts',
    purpose: '默认规格测试覆盖高价值模块边界',
  },
  {
    path: 'tests/spec/ci-quality-gate-contract.ts',
    purpose: '默认 Node spec 覆盖 CI 质量门',
  },
];

function pathExists(relativePath: string): boolean {
  /** 判断文档或默认测试是否已经同步落地。 */
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function readRepoFile(relativePath: string): string {
  /** 读取真实文档和测试，不允许用 change 文档替代 durable spec。 */
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function writeDocsAudit(): void {
  /** 产出 docs-tests-sync-audit，便于审阅者看到缺口。 */
  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  fs.writeFileSync(
    EVIDENCE_PATH,
    `${JSON.stringify({
      evidenceId: 'docs-tests-sync-audit',
      requiredPaths: REQUIRED_PATHS.map((entry) => ({
        ...entry,
        exists: pathExists(entry.path),
      })),
      specsIndexMentionsHighValue: readRepoFile('docs/specs/index.md').includes('high-value-module-refactor'),
      specsIndexMentionsCi: /CI|ci|质量门|GitHub/.test(readRepoFile('docs/specs/index.md')),
    }, null, 2)}\n`,
    'utf8',
  );
}

test('durable spec、规格索引和默认测试跟随高价值重构更新', () => {
  writeDocsAudit();

  for (const entry of REQUIRED_PATHS) {
    assert.equal(pathExists(entry.path), true, `${entry.purpose} 必须存在：${entry.path}`);
    const source = readRepoFile(entry.path);
    assert.match(source.slice(0, 260), /PURPOSE|文件目的|#|规格/, `${entry.path} 必须说明业务目的`);
  }

  const index = readRepoFile('docs/specs/index.md');
  assert.match(index, /high-value-module-refactor/, 'docs/specs/index.md 必须链接高价值模块重构规格');
  assert.match(index, /CI|ci|质量门|GitHub/, 'docs/specs/index.md 必须能检索到 CI 质量门修复规格');
});

test('durable spec 明确绑定目标模块、测试入口和 GitHub CI 失败事实', () => {
  writeDocsAudit();

  assert.equal(
    pathExists('docs/specs/high-value-module-refactor.md'),
    true,
    '缺少 durable spec，无法检查目标模块和 CI 失败事实',
  );
  const doc = readRepoFile('docs/specs/high-value-module-refactor.md');
  for (const requiredText of [
    'ChatInterface.tsx',
    'ChatMessagesPane.tsx',
    'useProjectsState.ts',
    '28289064798',
    'Node spec tests',
    'test:ci',
  ]) {
    assert.match(doc, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `durable spec 必须包含 ${requiredText}`);
  }
});
