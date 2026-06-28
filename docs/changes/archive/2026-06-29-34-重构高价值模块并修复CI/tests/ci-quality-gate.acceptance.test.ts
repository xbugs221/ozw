/**
 * PURPOSE: Contract-test GitHub CI and local package quality gates so CI/CD
 * failures are fixed by aligning real commands instead of skipping checks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
const PACKAGE_JSON_PATH = 'package.json';
const SPEC_LIST_SCRIPT_PATH = 'scripts/list-node-spec-tests.mjs';
const CI_AUDIT_PATH = path.join(REPO_ROOT, 'test-results/github-ci/ci-gate-audit.json');
const FAILURE_METADATA_PATH = path.join(REPO_ROOT, 'test-results/github-ci/latest-failure.json');
const AFTER_FIX_METADATA_PATH = path.join(REPO_ROOT, 'test-results/github-ci/after-fix-run.json');

type PackageJson = {
  scripts?: Record<string, string>;
};

type GitHubRunMetadata = {
  evidenceId?: string;
  databaseId?: number;
  workflow?: string;
  workflowName?: string;
  headBranch?: string;
  event?: string;
  status?: string;
  conclusion?: string;
  url?: string;
  qualityGate?: string;
  note?: string;
  job?: string;
  jobs?: Array<{
    name?: string;
    conclusion?: string;
    status?: string;
  }>;
};

function readRepoFile(relativePath: string): string {
  /** 读取真实仓库文件，确保 CI 合同检查当前配置。 */
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readJsonFile<T>(filePath: string): T | null {
  /** 读取运行证据 JSON；缺失时返回 null，让断言给出合同上下文。 */
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function loadScripts(): Record<string, string> {
  /** 解析 package.json scripts，作为本地质量门事实来源。 */
  const pkg = JSON.parse(readRepoFile(PACKAGE_JSON_PATH)) as PackageJson;
  return pkg.scripts || {};
}

function isRealSuccessfulAfterFixRun(metadata: GitHubRunMetadata | null): boolean {
  /** 校验修复后证据来自真实 GitHub CI 成功 run，而不是本地占位。 */
  return Boolean(
    metadata &&
      metadata.evidenceId === 'github-ci-after-fix-metadata' &&
      typeof metadata.databaseId === 'number' &&
      metadata.workflowName === 'CI' &&
      metadata.headBranch === 'main' &&
      metadata.event === 'push' &&
      metadata.status === 'completed' &&
      metadata.conclusion === 'success' &&
      typeof metadata.url === 'string' &&
      /^https:\/\/github\.com\/xbugs221\/ozw\/actions\/runs\/\d+$/.test(metadata.url) &&
      metadata.jobs?.some(
        (job) => job.name === 'node-checks' && job.status === 'completed' && job.conclusion === 'success',
      ),
  );
}

function isLocalAfterFixVerification(metadata: GitHubRunMetadata | null): boolean {
  /** 校验无远端成功 run 时的本地同入口质量门证据，避免把它误标为 GitHub run。 */
  return Boolean(
    metadata &&
      metadata.evidenceId === 'github-ci-after-fix-metadata' &&
      metadata.workflow === 'CI' &&
      metadata.job === 'node-checks' &&
      metadata.status === 'local-verified' &&
      metadata.conclusion === 'success' &&
      metadata.qualityGate === 'pnpm run test:ci' &&
      typeof metadata.note === 'string' &&
      metadata.note.length > 0 &&
      metadata.databaseId === undefined &&
      metadata.workflowName === undefined &&
      metadata.url === undefined,
  );
}

function writeCiEvidence(): {
  scripts: Record<string, string>;
  workflow: string;
  latestFailure: Record<string, unknown>;
  afterFixMetadata: GitHubRunMetadata | null;
  hasRealAfterFixMetadata: boolean;
} {
  /** 产出 ci-gate-audit 和最新 GitHub 失败 run 元数据。 */
  const scripts = loadScripts();
  const workflow = readRepoFile(CI_WORKFLOW_PATH);
  const afterFixMetadata = readJsonFile<GitHubRunMetadata>(AFTER_FIX_METADATA_PATH);
  const latestFailure = {
    evidenceId: 'github-ci-failure-metadata',
    runId: '28289064798',
    workflow: 'CI',
    branch: 'main',
    event: 'push',
    job: 'node-checks',
    failedStep: 'Node spec tests',
    url: 'https://github.com/xbugs221/ozw/actions/runs/28289064798',
  };
  const hasRealAfterFixMetadata = isRealSuccessfulAfterFixRun(afterFixMetadata);

  fs.mkdirSync(path.dirname(CI_AUDIT_PATH), { recursive: true });
  fs.writeFileSync(
    CI_AUDIT_PATH,
    `${JSON.stringify({
      evidenceId: 'ci-gate-audit',
      testCi: scripts['test:ci'] || null,
      workflowIncludesVitest: workflow.includes('test:vitest'),
      workflowIncludesNodeSpec: /test:spec:node/.test(workflow),
      workflowUsesRunSyntax: /pnpm run test:spec:node/.test(workflow) || /pnpm run test:ci/.test(workflow),
      specListScriptExists: fs.existsSync(path.join(REPO_ROOT, SPEC_LIST_SCRIPT_PATH)),
      hasRealAfterFixMetadata,
      hasLocalAfterFixVerification: isLocalAfterFixVerification(afterFixMetadata),
      afterFixRunId: afterFixMetadata?.databaseId || null,
    }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(FAILURE_METADATA_PATH, `${JSON.stringify(latestFailure, null, 2)}\n`, 'utf8');

  return { scripts, workflow, latestFailure, afterFixMetadata, hasRealAfterFixMetadata };
}

test('本地 test:ci 与 GitHub node-checks 质量门对齐', () => {
  const { scripts, workflow } = writeCiEvidence();
  const testCi = scripts['test:ci'] || '';

  assert.ok(testCi, 'package.json 必须提供 test:ci，避免 GitHub workflow 和本地质量门分叉');
  for (const requiredCommand of ['typecheck', 'test:vitest', 'test:server', 'test:spec:node']) {
    assert.match(testCi, new RegExp(requiredCommand.replace(':', ':')), `test:ci 必须覆盖 ${requiredCommand}`);
  }
  assert.match(workflow, /node-version-file:\s+\.nvmrc/, 'GitHub CI 必须继续使用 .nvmrc');
  assert.match(workflow, /pnpm install --frozen-lockfile/, 'GitHub CI 必须使用 frozen lockfile 安装');
  assert.ok(
    workflow.includes('pnpm run test:ci') ||
      (workflow.includes('pnpm run typecheck') &&
        workflow.includes('pnpm run test:vitest') &&
        workflow.includes('pnpm run test:server') &&
        workflow.includes('pnpm run test:spec:node')),
    'GitHub node-checks 必须使用或镜像 test:ci 的质量门',
  );
  assert.doesNotMatch(workflow, /--skip|test\.skip|continue-on-error:\s*true/, 'CI 不得通过跳过或忽略错误变绿');
});

test('Node spec tests 保留在 CI 中，并记录失败 run 与修复后通过 run', () => {
  const { workflow, latestFailure, afterFixMetadata, hasRealAfterFixMetadata } = writeCiEvidence();
  const hasLocalAfterFixVerification = isLocalAfterFixVerification(afterFixMetadata);

  assert.equal(latestFailure.runId, '28289064798');
  assert.equal(latestFailure.failedStep, 'Node spec tests');
  assert.match(workflow, /Node spec tests|test:spec:node/, 'CI 必须保留 Node spec tests');
  assert.match(readRepoFile(SPEC_LIST_SCRIPT_PATH), /tests\/spec/, 'Node spec 列表脚本必须继续选择 tests/spec');
  assert.equal(
    hasRealAfterFixMetadata || hasLocalAfterFixVerification,
    true,
    `修复后必须写入 GitHub success run 元数据，或明确的本地同入口质量门通过证据；当前证据为：${JSON.stringify(afterFixMetadata)}`,
  );
});
