/**
 * PURPOSE: 契约测试，约束项目域核心实现必须进入 TypeScript 编译边界。
 *
 * 业务意义：项目列表、会话路由、Provider 会话和项目重命名都是 ozw 的核心入口，
 * 不能继续由手写 JS + d.ts 配对绕过类型检查。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const CHANGE_RESULT_DIR = path.join(REPO_ROOT, 'test-results/13-project-domain-ts-boundary');

/**
 * 读取仓库文件，供源码边界断言使用。
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 记录本次契约测试审计到 test-results，便于执行阶段复核。
 */
async function writeAudit(snapshot: unknown): Promise<void> {
  await mkdir(CHANGE_RESULT_DIR, { recursive: true });
  await writeFile(path.join(CHANGE_RESULT_DIR, 'source-audit.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

test('项目域核心不再依赖手写 JS 和 d.ts 配对', async () => {
  const packageJson = JSON.parse(await readRepoFile('package.json')) as {
    scripts?: Record<string, string>;
  };
  const nodeTsconfig = JSON.parse(await readRepoFile('tsconfig.node.json')) as {
    compilerOptions?: { allowJs?: boolean };
  };
  const serviceSource = await readRepoFile('backend/domains/projects/project-domain-service.ts');
  const coreImportSpecifiers = Array.from(
    serviceSource.matchAll(/from ['"]\.\/project-domain-core\.(js|ts)['"]/g),
    (match) => match[1],
  );

  const snapshot = {
    hasProjectDomainCoreJs: existsSync(path.join(REPO_ROOT, 'backend/domains/projects/project-domain-core.js')),
    hasProjectDomainCoreDts: existsSync(path.join(REPO_ROOT, 'backend/domains/projects/project-domain-core.d.ts')),
    hasProjectDomainCoreTs: existsSync(path.join(REPO_ROOT, 'backend/domains/projects/project-domain-core.ts')),
    buildServerScript: packageJson.scripts?.['build:server'] || '',
    nodeAllowJs: nodeTsconfig.compilerOptions?.allowJs ?? false,
    coreImportSpecifiers,
  };

  await writeAudit(snapshot);

  assert.equal(snapshot.hasProjectDomainCoreJs, false, '项目域核心实现不得继续是 project-domain-core.js');
  assert.equal(snapshot.hasProjectDomainCoreDts, false, '迁移后不得保留 project-domain-core.d.ts 手写声明配对');
  assert.equal(snapshot.hasProjectDomainCoreTs, true, '项目域核心或兼容 facade 应存在 TypeScript 源码入口');
  assert.equal(snapshot.nodeAllowJs, false, 'Node TypeScript 配置必须继续禁用 allowJs');
  assert.ok(!snapshot.buildServerScript.includes('copy-build-runtime-js.mjs'), '服务端构建不得复制项目域手写 JS');
  assert.equal(snapshot.coreImportSpecifiers.includes('ts'), false, '项目域 public service 不得使用破坏构建的 .ts 扩展导入');
  assert.equal(snapshot.hasProjectDomainCoreJs && snapshot.coreImportSpecifiers.includes('js'), false, '项目域 public service 不得反向导出物理 JS core');
});

test('公共项目 facade 保留核心业务入口', async () => {
  const publicFacade = await readRepoFile('backend/projects.ts');
  const domainService = await readRepoFile('backend/domains/projects/project-domain-service.ts');
  const combined = `${publicFacade}\n${domainService}`;
  const requiredExports = [
    'getProjects',
    'getSessionMessages',
    'createManualSessionDraft',
    'finalizeManualSessionRoute',
    'renameProject',
    'renameSession',
    'searchChatHistory',
    'indexProviderSessionFile',
  ];

  for (const exportName of requiredExports) {
    assert.match(combined, new RegExp(`\\b${exportName}\\b`), `公共项目 facade 必须继续暴露 ${exportName}`);
  }
});
