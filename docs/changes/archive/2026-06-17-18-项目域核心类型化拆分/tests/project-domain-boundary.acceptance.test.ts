/**
 * 文件目的：用源码审计约束项目域拆分，防止执行阶段只新增薄 wrapper 或继续保留迁移巨型 core。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const REPO_ROOT = process.cwd();
const EVIDENCE_DIR = path.join(REPO_ROOT, 'test-results', '18-project-domain-boundary');

const REQUIRED_PUBLIC_EXPORTS = [
  'getProjects',
  'getSessionMessages',
  'createManualSessionDraft',
  'finalizeManualSessionRoute',
  'renameProject',
  'renameSession',
  'searchChatHistory',
  'indexProviderSessionFile',
];

const CORE_OWNED_ENTRY_NAMES = [
  'getProjects',
  'getCodexSessions',
  'getPiSessions',
  'getSessionMessages',
  'createManualSessionDraft',
  'finalizeManualSessionRoute',
  'searchChatHistory',
  'deleteSession',
  'deleteProject',
  'renameProject',
  'renameSession',
  'buildCodexProviderSessionsReadModel',
  'buildPiProviderSessionsReadModel',
];

const FOCUSED_MODULES = [
  'backend/domains/projects/project-discovery-read-model.ts',
  'backend/domains/projects/project-overview-service.ts',
  'backend/domains/projects/manual-session-route-read-model.ts',
  'backend/domains/projects/chat-history-search-service.ts',
  'backend/domains/projects/project-session-delete-service.ts',
  'backend/domains/projects/project-config-read-model.ts',
  'backend/domains/projects/project-rename-service.ts',
  'backend/domains/projects/provider-session-index-read-model.ts',
  'backend/domains/projects/provider-transcript-read-model.ts',
  'backend/domains/projects/provider-session-list-read-model.ts',
  'backend/domains/projects/provider-session-read-model.ts',
];

const PROJECT_DOMAIN_SOURCE_DIR = path.join(REPO_ROOT, 'backend', 'domains', 'projects');

/**
 * 读取 tracked 源码文件，统一把相对路径解析到仓库根目录。
 */
async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 把审计快照写入 test-results，方便执行阶段复核失败点和最终状态。
 */
async function writeEvidence(fileName: string, value: unknown): Promise<void> {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

/**
 * 列出项目域源码，确保 source audit 不只盯住兼容 shim。
 */
async function listProjectDomainSources(): Promise<string[]> {
  const entries = await fs.readdir(PROJECT_DOMAIN_SOURCE_DIR);
  return entries
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.js'))
    .map((entry) => `backend/domains/projects/${entry}`)
    .sort();
}

/**
 * 判断模块是否仍然只是迁移 core 或换名迁移仓库的转出口。
 */
function usesCoreBusinessReexport(source: string): boolean {
  return /from ['"]\.\/project-domain-(?:core|impl|runtime|runtime-compat|legacy-runtime)\.js['"]/.test(source);
}

/**
 * 判断模块是否只是把参数原样透传给换名迁移仓库。
 */
function isThinCompatWrapper(source: string): boolean {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return /Parameters<typeof \w+(?:From(?:Impl|Compat|Private)|Compat|Legacy)>/.test(withoutComments)
    || /return\s+\w+(?:From(?:Impl|Compat|Private)|Compat|Legacy)\(\.\.\.args\)/.test(withoutComments)
    || /function\s+\w+\s*\(\s*\.\.\.args:[^)]*\)\s*{[^}]*return\s+\w+\(\.\.\.args\)/s.test(withoutComments);
}

/**
 * 判断模块是否包含可审查实现，而不是只有 export 列表、哨兵常量或透传 wrapper。
 */
function hasReviewableImplementation(source: string): boolean {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const functionCount = (withoutComments.match(/\b(?:export\s+)?(?:async\s+)?function\s+\w+/g) || []).length;
  const typedConstCount = (withoutComments.match(/\bconst\s+\w+\s*[:=]/g) || []).length;
  const sentinelOnly = /export const \w+Entry = true/.test(withoutComments);
  return !isThinCompatWrapper(source) && (functionCount >= 1 || (typedConstCount >= 3 && !sentinelOnly));
}

test('项目域迁移 core 不再使用 TS suppression 且不再是换名巨型业务仓库', async () => {
  const source = await readSource('backend/domains/projects/project-domain-core.ts');
  const projectDomainSources = await listProjectDomainSources();
  const sourceAudits = await Promise.all(projectDomainSources.map(async (relativePath) => {
    const fileSource = await readSource(relativePath);
    const byteCount = Buffer.byteLength(fileSource, 'utf8');
    return {
      relativePath,
      lineCount: fileSource.split('\n').length,
      byteCount,
      hasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(fileSource),
      looksLikeRenamedMigrationCore: /project-domain-(?:impl|runtime|private)\.(?:ts|js)$/.test(relativePath)
        && (fileSource.split('\n').length > 1200 || byteCount > 120 * 1024),
    };
  }));
  const definedEntryNames = CORE_OWNED_ENTRY_NAMES.filter((name) => (
    new RegExp(`(?:async\\s+)?function\\s+${name}\\b|const\\s+${name}\\s*=`).test(source)
  ));
  const snapshot = {
    lineCount: source.split('\n').length,
    hasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(source),
    definedEntryNames,
    sourceAudits,
  };

  await writeEvidence('source-audit.json', snapshot);

  assert.equal(snapshot.hasTypeSuppression, false, 'project-domain-core.ts 不得继续使用 TypeScript suppression');
  assert.ok(snapshot.lineCount <= 1200, `project-domain-core.ts 应收敛到 1200 行以内，当前为 ${snapshot.lineCount} 行`);
  assert.deepEqual(snapshot.definedEntryNames, [], '主要项目域业务入口不得继续定义在迁移 core 中');
  for (const audit of sourceAudits) {
    assert.equal(audit.hasTypeSuppression, false, `${audit.relativePath} 不得使用 TypeScript suppression`);
    assert.equal(audit.looksLikeRenamedMigrationCore, false, `${audit.relativePath} 不得作为换名巨型迁移 core`);
  }
});

test('focused project modules 拥有真实实现而不是从迁移 core 薄 re-export', async () => {
  const moduleSnapshots = [];

  for (const relativePath of FOCUSED_MODULES) {
    const source = await readSource(relativePath);
    moduleSnapshots.push({
      relativePath,
      usesCoreBusinessReexport: usesCoreBusinessReexport(source),
      isThinCompatWrapper: isThinCompatWrapper(source),
      hasReviewableImplementation: hasReviewableImplementation(source),
      hasEntrySentinel: /export const \w+Entry = true/.test(source),
      hasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(source),
    });
  }

  await writeEvidence('module-ownership.json', moduleSnapshots);

  for (const snapshot of moduleSnapshots) {
    assert.equal(snapshot.hasTypeSuppression, false, `${snapshot.relativePath} 不得新增 TS suppression`);
    assert.equal(snapshot.usesCoreBusinessReexport, false, `${snapshot.relativePath} 不得继续从迁移 core 或换名 runtime 薄 re-export 业务入口`);
    assert.equal(snapshot.isThinCompatWrapper, false, `${snapshot.relativePath} 不得只把参数透传给换名迁移实现`);
    assert.equal(snapshot.hasEntrySentinel, false, `${snapshot.relativePath} 不得用 Entry=true 哨兵代替真实实现`);
    assert.equal(snapshot.hasReviewableImplementation, true, `${snapshot.relativePath} 必须包含可审查的真实实现`);
  }
});

test('project-domain service facade 保持公共入口但不直连迁移 core', async () => {
  const source = await readSource('backend/domains/projects/project-domain-service.ts');
  const projectsFacade = await readSource('backend/projects.ts');
  const snapshot = {
    importsMigrationCore: /from ['"]\.\/project-domain-core\.js['"]/.test(source),
    exportsAllFromService: /export \* from ['"]\.\/domains\/projects\/project-domain-service\.js['"]/.test(projectsFacade),
    missingPublicExports: REQUIRED_PUBLIC_EXPORTS.filter((name) => !new RegExp(`\\b${name}\\b`).test(source)),
  };

  await writeEvidence('service-facade.json', snapshot);

  assert.equal(snapshot.exportsAllFromService, true, 'backend/projects.ts 必须继续作为 project-domain-service 的兼容 facade');
  assert.equal(snapshot.importsMigrationCore, false, 'project-domain-service.ts 不得直接从迁移 core 导出业务入口');
  assert.deepEqual(snapshot.missingPublicExports, [], 'project-domain-service.ts 必须保留主要公共入口');
});
