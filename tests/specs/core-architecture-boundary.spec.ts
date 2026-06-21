/**
 * 文件目的：规格级保护核心架构拆分边界，避免 provider shared、chat runtime、agent route、HTTP deps 和工具配置回退。
 * Sources: 2026-06-18-29-收敛核心架构债和性能边界
 */
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

type FileAudit = {
  exists: boolean;
  lines: number | null;
  hasTsNoCheck: boolean | null;
};

/**
 * 读取仓库源码文本，避免规格测试依赖应用运行时副作用。
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 判断路径是否存在，让测试能给出业务化断言信息。
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
 * 统计源码物理行数，用于约束入口文件不要重新膨胀。
 */
function countLines(source: string): number {
  return source.length === 0 ? 0 : source.split('\n').length;
}

/**
 * 收集单个文件的存在性、行数和 TypeScript suppression 状态。
 */
async function auditFile(relativePath: string): Promise<FileAudit> {
  if (!(await pathExists(relativePath))) {
    return { exists: false, lines: null, hasTsNoCheck: null };
  }
  const source = await readRepoFile(relativePath);
  return { exists: true, lines: countLines(source), hasTsNoCheck: source.includes('@ts-nocheck') };
}

/**
 * 递归列出 TypeScript 源码，用于检查 provider runtime 是否反向依赖前端。
 */
async function listFilesRecursive(relativeDir: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(REPO_ROOT, relativeDir), { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const child = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) {
          return listFilesRecursive(child);
        }
        return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [child] : [];
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

/**
 * 读取 HTTP route 文件，定位 deps 类型逃逸。
 */
async function collectRouteDepsAnyMatches(): Promise<string[]> {
  const matches: string[] = [];
  const entries = await readdir(path.join(REPO_ROOT, 'backend/server/http'), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }
    const relativePath = `backend/server/http/${entry.name}`;
    const source = await readRepoFile(relativePath);
    if (/\bdeps\s*:\s*any\b/.test(source)) {
      matches.push(relativePath);
    }
    const routeDepsInterfaces = [...source.matchAll(/export interface \w*RouteDeps \{[\s\S]*?\n\}/g)];
    for (const match of routeDepsInterfaces) {
      if (/^\s+\w+\??:\s*any\b/m.test(match[0])) {
        matches.push(relativePath);
        break;
      }
    }
  }
  return matches;
}

test('provider transcript logic stays in shared code used by frontend and backend', async () => {
  /** 后端 provider runtime 只能依赖 shared reducer，不能反向导入前端 chat reducer。 */
  assert.equal(await pathExists('shared/provider-runtime-transcript.ts'), true);

  const providerRuntimeImportsFrontendChat: string[] = [];
  for (const relativePath of await listFilesRecursive('backend/domains/provider-runtime')) {
    const source = await readRepoFile(relativePath);
    if (/frontend\/components\/chat|from ['"].*components\/chat/.test(source)) {
      providerRuntimeImportsFrontendChat.push(relativePath);
    }
  }
  assert.deepEqual(providerRuntimeImportsFrontendChat, []);

  const frontendAdapter = await readRepoFile('frontend/components/chat/utils/nativeRuntimeTranscript.ts');
  const activeTurnStore = await readRepoFile('backend/domains/provider-runtime/active-turn-store.ts');
  const liveTranscriptStore = await readRepoFile('backend/domains/provider-runtime/live-transcript-store.ts');
  assert.match(frontendAdapter, /shared\/provider-runtime-transcript/);
  assert.match(activeTurnStore, /shared\/provider-runtime-transcript/);
  assert.match(liveTranscriptStore, /shared\/provider-runtime-transcript/);
  assert.equal((await auditFile('backend/domains/provider-runtime/active-turn-store.ts')).hasTsNoCheck, false);
  assert.equal((await auditFile('backend/domains/provider-runtime/live-transcript-store.ts')).hasTsNoCheck, false);
});

test('chat and project overview runtime files stay as orchestration layers', async () => {
  /** Runtime 入口保持低体量，真实业务规则由拆出的 loader/controller/section 承载。 */
  const lineBudgets: Record<string, number> = {
    'frontend/components/chat/session/useChatSessionStateRuntime.ts': 700,
    'frontend/components/chat/session/useChatSessionStateRuntime.impl.ts': 80,
    'frontend/components/chat/hooks/useChatRealtimeHandlersRuntime.ts': 700,
    'frontend/components/chat/hooks/useChatRealtimeHandlersRuntime.impl.ts': 80,
    'frontend/components/chat/composer/useChatComposerStateRuntime.ts': 700,
    'frontend/components/main-content/project-overview/ProjectOverviewPanelRuntime.tsx': 700,
    'frontend/components/main-content/view/subcomponents/ProjectOverviewPanelRuntime.tsx': 80,
  };

  for (const [relativePath, maxLines] of Object.entries(lineBudgets)) {
    const audit = await auditFile(relativePath);
    assert.equal(audit.exists, true, `${relativePath} must exist`);
    assert.ok((audit.lines ?? Number.POSITIVE_INFINITY) <= maxLines, `${relativePath} must stay under ${maxLines} lines`);
  }

  for (const relativePath of [
    'frontend/components/chat/session/sessionHistoryLoader.ts',
    'frontend/components/chat/session/sessionBulkMessageLoader.ts',
    'frontend/components/chat/session/sessionHydrationController.ts',
    'frontend/components/chat/session/sessionScrollController.ts',
    'frontend/components/chat/realtime/realtimeSessionLifecycle.ts',
    'frontend/components/chat/realtime/realtimeProviderEventController.ts',
    'frontend/components/chat/composer/composerAttachmentController.ts',
    'frontend/components/chat/composer/composerDispatchController.ts',
    'frontend/components/main-content/project-overview/projectOverviewActionController.ts',
    'frontend/components/main-content/project-overview/ProjectOverviewManualSessions.tsx',
    'frontend/components/main-content/project-overview/ProjectOverviewWorkflowSection.tsx',
    'frontend/components/main-content/project-overview/projectOverviewSelectionState.ts',
  ]) {
    assert.equal(await pathExists(relativePath), true, `${relativePath} must exist`);
  }
});

test('backend agent route and server HTTP deps keep explicit security and lifecycle boundaries', async () => {
  /** 安全敏感 agent route 和 HTTP route deps 必须有可审查 typed 边界。 */
  const route = await auditFile('backend/routes/agent.ts');
  const routeImpl = await auditFile('backend/routes/agent.impl.ts');
  assert.equal(route.exists, true);
  assert.ok((route.lines ?? Number.POSITIVE_INFINITY) <= 500);
  assert.equal(route.hasTsNoCheck, false);
  assert.equal(routeImpl.exists, true);
  assert.ok((routeImpl.lines ?? Number.POSITIVE_INFINITY) <= 80);
  assert.equal(routeImpl.hasTsNoCheck, false);

  for (const relativePath of [
    'backend/domains/agent/agent-auth.ts',
    'backend/domains/agent/agent-project-resolver.ts',
    'backend/domains/agent/github-operations.ts',
    'backend/domains/agent/agent-session-runner.ts',
    'backend/domains/agent/agent-response-writer.ts',
  ]) {
    assert.equal(await pathExists(relativePath), true, `${relativePath} must exist`);
  }

  const githubOperations = await readRepoFile('backend/domains/agent/github-operations.ts');
  assert.doesNotMatch(githubOperations, /https:\/\/\$\{[^}]*token|githubToken[^;\n]*(?:spawn|execFile|args)/);
  assert.match(githubOperations, /credential|GIT_ASKPASS|GIT_TERMINAL_PROMPT|Authorization/i);
  assert.deepEqual(await collectRouteDepsAnyMatches(), []);
});

test('tool config registry is split by family and avoids public any payload contracts', async () => {
  /** 工具配置扩展点必须通过工具族模块和 unknown/guard 边界维护。 */
  const registry = await auditFile('frontend/components/chat/toolConfigRegistry.ts');
  const legacyRegistry = await auditFile('frontend/components/chat/tools/configs/toolConfigRegistry.ts');
  assert.equal(registry.exists, true);
  assert.ok((registry.lines ?? Number.POSITIVE_INFINITY) <= 650);
  assert.equal(legacyRegistry.exists, true);
  assert.ok((legacyRegistry.lines ?? Number.POSITIVE_INFINITY) <= 80);

  for (const relativePath of [
    'frontend/components/chat/tool-config/readTools.ts',
    'frontend/components/chat/tool-config/editTools.ts',
    'frontend/components/chat/tool-config/execTools.ts',
    'frontend/components/chat/tool-config/providerTools.ts',
    'frontend/components/chat/tool-config/workflowTools.ts',
  ]) {
    assert.equal(await pathExists(relativePath), true, `${relativePath} must exist`);
  }

  const source = await readRepoFile('frontend/components/chat/tool-config/toolConfigRegistryRuntime.ts');
  const publicApi = [
    source.match(/export interface ToolDisplayConfig \{[\s\S]*?\n\}/)?.[0] ?? '',
    ...[...source.matchAll(/^export function .*$/gm)].map((match) => match[0]),
  ].join('\n');
  assert.deepEqual(publicApi.match(/\b(?:payload|input|args|details|result|toolResult)[A-Za-z0-9_]*\??\s*:\s*any\b/g) ?? [], []);
});
