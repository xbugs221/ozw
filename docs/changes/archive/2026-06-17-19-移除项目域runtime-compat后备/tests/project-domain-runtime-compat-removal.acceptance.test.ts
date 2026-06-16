/**
 * 文件目的：验证项目域已经移除旧 runtime compat/legacy runtime 后备，并保持 public facade 稳定。
 * 业务场景：项目清单、会话路由、Provider 会话和搜索等高频路径不能继续绕过 TypeScript 源码审查。
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_PATH = path.join(
  REPO_ROOT,
  'test-results/19-project-domain-runtime-compat/source-audit.json',
);

const PUBLIC_FACADE_ENTRIES = [
  'getProjects',
  'getSessionMessages',
  'createManualSessionDraft',
  'finalizeManualSessionRoute',
  'renameProject',
  'renameSession',
  'deleteProject',
  'searchChatHistory',
  'indexProviderSessionFile',
];

const PROJECT_DOMAIN_MODULES = [
  'backend/domains/projects/project-domain-core.ts',
  'backend/domains/projects/project-domain-service.ts',
  'backend/domains/projects/project-discovery-read-model.ts',
  'backend/domains/projects/project-config-read-model.ts',
  'backend/domains/projects/manual-session-route-read-model.ts',
  'backend/domains/projects/project-overview-service.ts',
  'backend/domains/projects/project-session-delete-service.ts',
  'backend/domains/projects/chat-history-search-service.ts',
  'backend/domains/projects/project-rename-service.ts',
  'backend/domains/projects/provider-session-index-read-model.ts',
  'backend/domains/projects/provider-transcript-read-model.ts',
];

const LEGACY_RUNTIME_FILES = [
  'backend/domains/projects/project-domain-runtime-compat.js',
  'backend/domains/projects/project-domain-runtime-compat.d.ts',
  'backend/domains/projects/project-domain-legacy-runtime.js',
  'backend/domains/projects/project-domain-legacy-runtime.d.ts',
];

const RENAMED_LEGACY_RUNTIME_PATTERNS = [
  /backend\/domains\/projects\/.*-implementation\.js$/,
  /backend\/domains\/projects\/.*-implementation\.d\.ts$/,
];

/**
 * Read a tracked repository file for source-boundary assertions.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Return whether a repository path currently exists.
 */
async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Return repository paths still using renamed legacy runtime implementation files.
 */
async function listRenamedLegacyRuntimeFiles(): Promise<string[]> {
  const projectsDir = path.join(REPO_ROOT, 'backend/domains/projects');
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(projectsDir));
  return entries
    .map((entry) => `backend/domains/projects/${entry}`)
    .filter((relativePath) => RENAMED_LEGACY_RUNTIME_PATTERNS.some((pattern) => pattern.test(relativePath)));
}

/**
 * Persist a source audit snapshot for execution reviewers.
 */
async function writeEvidence(snapshot: unknown): Promise<void> {
  await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

test('project domain no longer depends on runtime compat fallback', async () => {
  const moduleSources = await Promise.all(
    PROJECT_DOMAIN_MODULES.map(async (relativePath) => ({
      relativePath,
      source: await readRepoFile(relativePath),
    })),
  );
  const projectsFacade = await readRepoFile('backend/projects.ts');
  const serviceFacade = await readRepoFile('backend/domains/projects/project-domain-service.ts');

  const legacyRuntimeImporters = moduleSources
    .filter(({ source }) => /project-domain-(?:runtime-compat|legacy-runtime)\.js/.test(source))
    .map(({ relativePath }) => relativePath);
  const renamedLegacyRuntimeImporters = moduleSources
    .filter(({ source }) => /from\s+['"]\.\/[^'"]+-implementation\.js['"]/.test(source))
    .map(({ relativePath }) => relativePath);
  const existingLegacyRuntimeFiles = [];
  for (const relativePath of LEGACY_RUNTIME_FILES) {
    if (await pathExists(relativePath)) {
      existingLegacyRuntimeFiles.push(relativePath);
    }
  }
  const renamedLegacyRuntimeFiles = await listRenamedLegacyRuntimeFiles();
  const snapshot = {
    existingLegacyRuntimeFiles,
    renamedLegacyRuntimeFiles,
    legacyRuntimeImporters,
    renamedLegacyRuntimeImporters,
    projectDomainCoreExportsLegacyRuntime: /export\s+\*\s+from\s+['"]\.\/project-domain-(?:runtime-compat|legacy-runtime)\.js['"]/.test(
      moduleSources.find((entry) => entry.relativePath.endsWith('project-domain-core.ts'))?.source || '',
    ),
    facadeEntriesFound: PUBLIC_FACADE_ENTRIES.filter((entry) =>
      new RegExp(`\\b${entry}\\b`).test(`${projectsFacade}\n${serviceFacade}`),
    ),
  };

  await writeEvidence(snapshot);

  assert.deepEqual(snapshot.existingLegacyRuntimeFiles, [], `项目域旧运行体必须被删除: ${snapshot.existingLegacyRuntimeFiles.join(', ')}`);
  assert.deepEqual(snapshot.renamedLegacyRuntimeFiles, [], `项目域不得保留改名后的旧 JS/DTS 后备: ${snapshot.renamedLegacyRuntimeFiles.join(', ')}`);
  assert.deepEqual(snapshot.legacyRuntimeImporters, [], `项目域模块不得继续导入旧运行体: ${snapshot.legacyRuntimeImporters.join(', ')}`);
  assert.deepEqual(snapshot.renamedLegacyRuntimeImporters, [], `项目域模块不得继续导入改名后的旧 JS 后备: ${snapshot.renamedLegacyRuntimeImporters.join(', ')}`);
  assert.equal(snapshot.projectDomainCoreExportsLegacyRuntime, false, 'project-domain-core.ts 不得继续 export 旧运行体');
  assert.deepEqual(
    snapshot.facadeEntriesFound.sort(),
    PUBLIC_FACADE_ENTRIES.sort(),
    '项目域 public facade 必须继续暴露核心业务入口',
  );
});
