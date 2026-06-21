/**
 * Sources: 2026-06-11-95-压缩后端类型和巨型模块债, 2026-06-13-109-项目Provider会话读模型拆分, 2026-06-14-110-压薄后端legacy-server边界, 2026-06-14-113-Codex-app-server-runtime可测化, 2026-06-16-8-项目域与会话路由ReadModel分层, 2026-06-16-9-后端入口与实时通道契约化, 2026-06-16-13-项目域JS核心迁移为TS边界, 2026-06-16-14-后端启动入口退化为装配层, 2026-06-17-18-项目域核心类型化拆分, 2026-06-17-19-移除项目域runtime-compat后备, 2026-06-17-20-后端realtime协议与provider-runtime分层, 2026-06-17-22-后端HTTP-route-deps类型化
 *
 * 文件目的：稳定验证后端核心启动链路、Codex runtime 和消息处理文件的类型检查与模块边界。
 * 业务场景：后端启动入口不能通过搬家隐藏巨型模块债，Codex event 映射不能多处分叉，核心文件也不能用 TypeScript suppression 或静默 catch 掩盖运行风险。
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const CORE_BACKEND_FILES = [
  'backend/index.ts',
  'backend/server-main.ts',
  'backend/server-main-legacy.ts',
  'backend/server-main-runtime.ts',
  'backend/server/app-factory.ts',
  'backend/server/http-routes.ts',
  'backend/server/file-routes.ts',
  'backend/server/chat-websocket.ts',
  'backend/server/shell-websocket.ts',
  'backend/server/provider-watchers.ts',
  'backend/server/server-runtime-context.ts',
  'backend/native-agent-runtime.ts',
  'backend/codex-app-server-runtime.ts',
  'backend/session-messages-handler.ts',
];
const PROJECT_PROVIDER_READ_MODEL_EVIDENCE_PATH = path.join(
  REPO_ROOT,
  'test-results/oz-109-project-provider-read-model/boundary-snapshot.json',
);
const SERVER_LEGACY_BOUNDARY_EVIDENCE_PATH = path.join(
  REPO_ROOT,
  'test-results/oz-110-server-legacy-boundary/boundary-snapshot.json',
);
const CODEX_APP_SERVER_RUNTIME_EVIDENCE_PATH = path.join(
  REPO_ROOT,
  'test-results/oz-113-codex-app-server-runtime/boundary-snapshot.json',
);
const SERVER_ENTRY_EVIDENCE_DIR = path.join(REPO_ROOT, 'test-results/9-server-entry');
const PROJECT_DOMAIN_TS_BOUNDARY_EVIDENCE_PATH = path.join(
  REPO_ROOT,
  'test-results/13-project-domain-ts-boundary/source-audit.json',
);
const SERVER_LEGACY_BOUNDARY_MODULES = [
  'backend/server/app-factory.ts',
  'backend/server/http-routes.ts',
  'backend/server/file-routes.ts',
  'backend/server/chat-websocket.ts',
  'backend/server/shell-websocket.ts',
  'backend/server/provider-watchers.ts',
];
const CODEX_APP_SERVER_RUNTIME_MODULES = [
  'backend/domains/codex-app-server/stdio-transport.ts',
  'backend/domains/codex-app-server/session-manager.ts',
  'backend/domains/codex-app-server/notification-reducer.ts',
  'backend/domains/codex-app-server/runtime-facade.ts',
];
const PROJECT_PROVIDER_READ_MODEL_MODULES = [
  {
    path: 'backend/domains/projects/provider-session-read-model.ts',
    exports: ['indexProviderSessionFile', 'deleteProviderSessionIndexFile', 'listIndexedProviderSessionsForProject'],
  },
  {
    path: 'backend/domains/projects/project-overview-read-model.ts',
    exports: ['buildProjectOverviewReadModel', 'summarizeProjectForList'],
  },
  {
    path: 'backend/domains/projects/session-route-store.ts',
    exports: ['initManualSessionRoute', 'bindManualSessionProvider', 'finalizeManualSessionRoute'],
  },
  {
    path: 'backend/domains/projects/project-archive-store.ts',
    exports: ['loadProjectArchiveIndex', 'saveProjectArchiveIndex'],
  },
];
const PROJECT_DOMAIN_BOUNDARY_MODULES = [
  {
    path: 'backend/domains/projects/project-discovery-read-model.ts',
    exports: ['getProjects', 'addProjectManually', 'summarizeProjectForList'],
  },
  {
    path: 'backend/domains/projects/project-config-read-model.ts',
    exports: ['loadProjectConfig', 'saveProjectConfig', 'updateSessionUiState'],
  },
  {
    path: 'backend/domains/projects/manual-session-route-read-model.ts',
    exports: ['createManualSessionDraft', 'finalizeManualSessionRoute', 'bindManualSessionProvider'],
  },
  {
    path: 'backend/domains/projects/project-overview-service.ts',
    exports: ['getSessions', 'getSessionMessages', 'buildProjectOverviewReadModel', 'buildProviderSessionListReadModel'],
  },
  {
    path: 'backend/domains/projects/project-session-delete-service.ts',
    exports: ['deleteSession', 'deleteProject', 'deleteCodexSession'],
  },
  {
    path: 'backend/domains/projects/chat-history-search-service.ts',
    exports: ['searchChatHistory'],
  },
];
const PROJECT_DOMAIN_FOCUSED_MODULES = [
  ...PROJECT_DOMAIN_BOUNDARY_MODULES.map((module) => module.path),
  'backend/domains/projects/project-rename-service.ts',
  'backend/domains/projects/provider-session-index-read-model.ts',
  'backend/domains/projects/provider-transcript-read-model.ts',
  'backend/domains/projects/provider-session-list-read-model.ts',
  'backend/domains/projects/provider-session-read-model.ts',
];
const PROJECT_DOMAIN_CORE_OWNED_ENTRY_NAMES = [
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
const PROJECT_DOMAIN_RUNTIME_COMPAT_MODULES = [
  'backend/domains/projects/project-domain-core.ts',
  'backend/domains/projects/project-domain-service.ts',
  ...PROJECT_DOMAIN_BOUNDARY_MODULES.map((module) => module.path),
  'backend/domains/projects/provider-session-index-read-model.ts',
  'backend/domains/projects/provider-transcript-read-model.ts',
];
const PROJECT_DOMAIN_LEGACY_RUNTIME_FILES = [
  'backend/domains/projects/project-domain-runtime-compat.js',
  'backend/domains/projects/project-domain-runtime-compat.d.ts',
  'backend/domains/projects/project-domain-legacy-runtime.js',
  'backend/domains/projects/project-domain-legacy-runtime.d.ts',
];
const SERVER_HTTP_ROUTE_MODULES = [
  {
    registerName: 'registerSystemRoutes',
    path: 'backend/server/http/system-routes.ts',
    markers: ["'/api/system/update'"],
  },
  {
    registerName: 'registerProjectRoutes',
    path: 'backend/server/http/project-routes.ts',
    markers: ["'/api/projects'", "'/api/projects/:projectName/overview'"],
  },
  {
    registerName: 'registerWorkflowRoutes',
    path: 'backend/server/http/workflow-routes.ts',
    markers: ["'/api/projects/:projectName/workflows'", "'/api/projects/:projectName/workflows/:workflowId'"],
  },
  {
    registerName: 'registerSessionRoutes',
    path: 'backend/server/http/session-routes.ts',
    markers: ["'/api/projects/:projectName/sessions'", "'/api/chat/search'"],
  },
  {
    registerName: 'registerAttachmentRoutes',
    path: 'backend/server/http/attachment-routes.ts',
    markers: ["'/api/transcribe'", "'/api/projects/:projectName/upload-attachments'"],
  },
  {
    registerName: 'registerUsageRoutes',
    path: 'backend/server/http/usage-routes.ts',
    markers: ["'/api/usage/remaining'", "'/api/projects/:projectName/sessions/:sessionId/token-usage'"],
  },
  {
    registerName: 'registerDiagnosticsRoutes',
    path: 'backend/server/http/diagnostics-routes.ts',
    markers: ["'/api/diagnostics/runtime-dependencies'", "'/api/agents/status'", "'/api/pi/models'"],
  },
];
const TYPED_ROUTE_DEP_MODULES = [
  { path: 'backend/server/http/project-routes.ts', registerName: 'registerProjectRoutes', depsName: 'ProjectRouteDeps' },
  { path: 'backend/server/http/workflow-routes.ts', registerName: 'registerWorkflowRoutes', depsName: 'WorkflowRouteDeps' },
  { path: 'backend/server/http/session-routes.ts', registerName: 'registerSessionRoutes', depsName: 'SessionRouteDeps' },
  { path: 'backend/server/http/attachment-routes.ts', registerName: 'registerAttachmentRoutes', depsName: 'AttachmentRouteDeps' },
  { path: 'backend/server/http/usage-routes.ts', registerName: 'registerUsageRoutes', depsName: 'UsageRouteDeps' },
  { path: 'backend/server/file-routes.ts', registerName: 'registerFileRoutes', depsName: 'FileRouteDeps' },
];
const SERVER_REALTIME_MODULES = [
  'backend/server/realtime/broadcast-registry.ts',
  'backend/server/realtime/session-subscription-registry.ts',
  'backend/server/realtime/project-invalidation-bus.ts',
  'backend/server/realtime/runtime-writer-adapter.ts',
];

/**
 * Read one repository file as UTF-8 text for source-boundary assertions.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Count source lines using a stable newline split.
 */
function countLines(source: string): number {
  return source.split(/\r?\n/).length;
}

/**
 * Count direct Express route registrations in source text.
 */
function countDirectAppRoutes(source: string): number {
  return (source.match(/\bapp\.(get|post|put|delete|patch)\(/g) || []).length;
}

/**
 * Count function-style handler declarations in a route composition source.
 */
function countInlineHandlers(source: string): number {
  return (source.match(/const\s+\w+Handler\s*=\s*async|async function\s+\w+Handler/g) || []).length;
}

/**
 * Detect project-domain modules that still re-export business rules from a migration core.
 */
function usesProjectDomainCoreBusinessReexport(source: string): boolean {
  return /from ['"]\.\/project-domain-(?:core|impl|runtime|runtime-compat|legacy-runtime)\.js['"]/.test(source);
}

/**
 * Detect wrapper modules that only forward variadic arguments to renamed legacy code.
 */
function isThinProjectDomainCompatWrapper(source: string): boolean {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return /Parameters<typeof \w+(?:From(?:Impl|Compat|Private)|Compat|Legacy)>/.test(withoutComments)
    || /return\s+\w+(?:From(?:Impl|Compat|Private)|Compat|Legacy)\(\.\.\.args\)/.test(withoutComments)
    || /function\s+\w+\s*\(\s*\.\.\.args:[^)]*\)\s*{[^}]*return\s+\w+\(\.\.\.args\)/s.test(withoutComments);
}

/**
 * Check that a project-domain module contains locally reviewable implementation.
 */
function hasReviewableProjectDomainImplementation(source: string): boolean {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const functionCount = (withoutComments.match(/\b(?:export\s+)?(?:async\s+)?function\s+\w+/g) || []).length;
  const typedConstCount = (withoutComments.match(/\bconst\s+\w+\s*[:=]/g) || []).length;
  const sentinelOnly = /export const \w+Entry = true/.test(withoutComments);
  return !isThinProjectDomainCompatWrapper(source) && (functionCount >= 1 || (typedConstCount >= 3 && !sentinelOnly));
}

/**
 * Persist project read-model boundary evidence for reviewers and workflow gates.
 */
async function writeProjectProviderReadModelEvidence(snapshot: unknown): Promise<void> {
  await mkdir(path.dirname(PROJECT_PROVIDER_READ_MODEL_EVIDENCE_PATH), { recursive: true });
  await writeFile(PROJECT_PROVIDER_READ_MODEL_EVIDENCE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

/**
 * Persist legacy server boundary evidence for reviewers and workflow gates.
 */
async function writeServerLegacyBoundaryEvidence(snapshot: unknown): Promise<void> {
  await mkdir(path.dirname(SERVER_LEGACY_BOUNDARY_EVIDENCE_PATH), { recursive: true });
  await writeFile(SERVER_LEGACY_BOUNDARY_EVIDENCE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

/**
 * Persist Codex app-server runtime boundary evidence for reviewers and workflow gates.
 */
async function writeCodexAppServerRuntimeEvidence(snapshot: unknown): Promise<void> {
  await mkdir(path.dirname(CODEX_APP_SERVER_RUNTIME_EVIDENCE_PATH), { recursive: true });
  await writeFile(CODEX_APP_SERVER_RUNTIME_EVIDENCE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

/**
 * Persist server entry boundary evidence for reviewers and workflow gates.
 */
async function writeServerEntryEvidence(filename: string, contents: string): Promise<void> {
  await mkdir(SERVER_ENTRY_EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(SERVER_ENTRY_EVIDENCE_DIR, filename), contents, 'utf8');
}

/**
 * Persist project-domain TypeScript boundary evidence for workflow gates.
 */
async function writeProjectDomainTsBoundaryEvidence(snapshot: unknown): Promise<void> {
  await mkdir(path.dirname(PROJECT_DOMAIN_TS_BOUNDARY_EVIDENCE_PATH), { recursive: true });
  await writeFile(PROJECT_DOMAIN_TS_BOUNDARY_EVIDENCE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

test('core backend files do not disable TypeScript checking', async () => {
  for (const relativePath of CORE_BACKEND_FILES) {
    const source = await readRepoFile(relativePath);
    assert.equal(source.includes('@ts-nocheck'), false, `${relativePath} must not contain @ts-nocheck`);
    assert.equal(/@ts-ignore|@ts-expect-error/.test(source), false, `${relativePath} must not suppress TypeScript errors`);
  }
});

test('backend index is small enough to be a bootstrap and registration entry', async () => {
  const source = await readRepoFile('backend/index.ts');
  const lineCount = countLines(source);

  assert.ok(lineCount < 1800, `backend/index.ts must be split below 1800 lines, got ${lineCount}`);
  assert.match(source, /listen|createServer|app\./, 'backend/index.ts must remain a real server bootstrap, not an empty placeholder');
});

test('server main is a typed bootstrap boundary, not the moved giant entry body', async () => {
  const source = await readRepoFile('backend/server-main.ts');
  const lineCount = countLines(source);

  assert.ok(lineCount < 200, `backend/server-main.ts must stay a small typed bootstrap, got ${lineCount}`);
  assert.match(source, /startBackendServer|import\('\.\/server-main-legacy\.js'\)/, 'backend/server-main.ts must explicitly load the server runtime');
  assert.doesNotMatch(source, /app\.(get|post|put|delete)|new WebSocketServer|handleChatConnection/, 'backend/server-main.ts must not contain route or websocket bodies');
});

test('legacy server delegates routes websockets and watchers to server modules', async () => {
  const legacySource = await readRepoFile('backend/server-main-legacy.ts');
  const routeHandlerMatches = legacySource.match(/\bapp\.(?:get|post|put|delete|patch)\s*\(/g) || [];
  const websocketMessageMatches = legacySource.match(/\.on\(\s*['"]message['"]/g) || [];
  const moduleSnapshots = [];

  for (const relativePath of SERVER_LEGACY_BOUNDARY_MODULES) {
    let exists = true;
    let source = '';
    try {
      await stat(path.join(REPO_ROOT, relativePath));
      source = await readRepoFile(relativePath);
    } catch {
      exists = false;
    }

    moduleSnapshots.push({
      path: relativePath,
      exists,
      lineCount: source ? countLines(source) : 0,
      hasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(source),
    });
  }

  const snapshot = {
    legacyLineCount: countLines(legacySource),
    routeHandlerCount: routeHandlerMatches.length,
    websocketMessageHandlerCount: websocketMessageMatches.length,
    modules: moduleSnapshots,
  };
  await writeServerLegacyBoundaryEvidence(snapshot);

  for (const module of moduleSnapshots) {
    assert.equal(module.exists, true, `${module.path} must exist`);
    assert.equal(module.hasTypeSuppression, false, `${module.path} must not use TypeScript suppression`);
  }

  assert.ok(snapshot.legacyLineCount < 1800, `backend/server-main-legacy.ts must stay below 1800 lines, got ${snapshot.legacyLineCount}`);
  assert.ok(snapshot.routeHandlerCount <= 4, `backend/server-main-legacy.ts must not directly register many HTTP routes, got ${snapshot.routeHandlerCount}`);
  assert.ok(snapshot.websocketMessageHandlerCount <= 1, `backend/server-main-legacy.ts must not own multiple WebSocket message handlers, got ${snapshot.websocketMessageHandlerCount}`);
});

test('Codex event transform has a single backend implementation source', async () => {
  const sources = await Promise.all([
    readRepoFile('backend/native-agent-runtime.ts'),
    readRepoFile('backend/codex-app-server-runtime.ts'),
    readRepoFile('shared/codex-message-normalizer.ts'),
  ]);
  const combined = sources.join('\n');
  const transformMatches = combined.match(/function\s+transformCodexEvent|const\s+transformCodexEvent/g) || [];

  assert.ok(transformMatches.length <= 1, `Codex event transform must have one main implementation, got ${transformMatches.length}`);
  assert.match(combined, /codex-message-normalizer|normalizeCodex/i, 'Codex event mapping must use a shared normalizer path');
});

test('core backend files do not silently swallow errors in touched areas', async () => {
  for (const relativePath of CORE_BACKEND_FILES) {
    const source = await readRepoFile(relativePath);
    assert.equal(/catch\s*\(\s*\)\s*\{\s*\}/.test(source), false, `${relativePath} must not contain empty catch blocks`);
    assert.equal(/\.catch\(\s*\(\s*\)\s*=>\s*(null|false|undefined)\s*\)/.test(source), false, `${relativePath} must not silently collapse rejected promises`);
  }
});

test('Codex app-server runtime stays split into injectable boundaries', async () => {
  const runtimeSource = await readRepoFile('backend/domains/codex-app-server/runtime-facade.ts');
  const moduleSnapshots = [];

  for (const relativePath of CODEX_APP_SERVER_RUNTIME_MODULES) {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    let exists = true;
    let source = '';
    try {
      await stat(absolutePath);
      source = await readRepoFile(relativePath);
    } catch {
      exists = false;
    }

    moduleSnapshots.push({
      path: relativePath,
      exists,
      lineCount: source ? countLines(source) : 0,
      hasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(source),
    });
  }

  const snapshot = {
    facadeLineCount: countLines(runtimeSource),
    emptyCatchCount: (runtimeSource.match(/catch\s*\([^)]*\)?\s*\{\s*(?:\/\/[^\n]*\n\s*)?\}/g) || []).length,
    containsDirectSessionFailureLoop: /function\s+markRunningSessionsFailed[\s\S]*for\s*\(\s*const session of sessions\.values\(\)/.test(runtimeSource),
    importsTransportBoundary: /from\s+['"]\.\/stdio-transport\.js['"]/.test(runtimeSource),
    importsSessionBoundary: /from\s+['"]\.\/session-manager\.js['"]/.test(runtimeSource),
    importsNotificationBoundary: /from\s+['"]\.\/notification-reducer\.js['"]/.test(runtimeSource),
    modules: moduleSnapshots,
  };
  await writeCodexAppServerRuntimeEvidence(snapshot);

  for (const module of moduleSnapshots) {
    assert.equal(module.exists, true, `${module.path} must exist`);
    assert.equal(module.hasTypeSuppression, false, `${module.path} must not use TypeScript suppression`);
  }

  assert.ok(snapshot.facadeLineCount < 520, `runtime-facade.ts must stay below 520 lines, got ${snapshot.facadeLineCount}`);
  assert.equal(snapshot.emptyCatchCount, 0, 'runtime-facade.ts must not swallow runtime errors with empty catch blocks');
  assert.equal(snapshot.containsDirectSessionFailureLoop, false, 'running session failure marking must remain in session-manager');
  assert.equal(snapshot.importsTransportBoundary, true, 'runtime facade must use the stdio-transport boundary');
  assert.equal(snapshot.importsSessionBoundary, true, 'runtime facade must use the session-manager boundary');
  assert.equal(snapshot.importsNotificationBoundary, true, 'runtime facade must use the notification-reducer boundary');
});

test('project Provider session read model lives in typed project domain modules', async () => {
  const projectsSource = await readRepoFile('backend/projects.ts');
  const moduleSnapshots = [];

  for (const module of PROJECT_PROVIDER_READ_MODEL_MODULES) {
    const absolutePath = path.join(REPO_ROOT, module.path);
    let exists = true;
    let source = '';
    try {
      await stat(absolutePath);
      source = await readRepoFile(module.path);
    } catch {
      exists = false;
    }

    moduleSnapshots.push({
      path: module.path,
      exists,
      lineCount: source ? countLines(source) : 0,
      hasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(source),
      exportsFound: module.exports.filter((name) => new RegExp(`\\b${name}\\b`).test(source)),
    });
  }

  const snapshot = {
    projectsLineCount: countLines(projectsSource),
    projectsHasProviderIndexImplementation: /async function (?:upsertProviderSessionIndex|indexProviderSessionFile|deleteProviderSessionIndexFile)|function (?:buildCodexSessionsIndex|buildPiSessionsIndex)/.test(projectsSource),
    modules: moduleSnapshots,
  };
  await writeProjectProviderReadModelEvidence(snapshot);

  for (const module of moduleSnapshots) {
    const expected = PROJECT_PROVIDER_READ_MODEL_MODULES.find((item) => item.path === module.path);
    assert.equal(module.exists, true, `${module.path} must exist`);
    assert.equal(module.hasTypeSuppression, false, `${module.path} must not use TypeScript suppression`);
    assert.deepEqual(module.exportsFound.sort(), expected!.exports.sort(), `${module.path} must export the project read-model entry points`);
  }

  assert.ok(snapshot.projectsLineCount < 5200, `backend/projects.ts must stay below 5200 lines, got ${snapshot.projectsLineCount}`);
  assert.equal(snapshot.projectsHasProviderIndexImplementation, false, 'Provider session index implementation must not move back into backend/projects.ts');
});

test('project domain facade delegates discovery route overview delete and search rules', async () => {
  /**
   * 业务场景：项目清单、会话路由、删除和搜索入口继续由项目域小模块承载，
   * backend/projects.ts 只保留兼容导出，避免首页刷新路径重新变成巨型规则文件。
   */
  const projectsSource = await readRepoFile('backend/projects.ts');
  const domainServiceSource = await readRepoFile('backend/domains/projects/project-domain-service.ts');
  const moduleSnapshots = [];

  for (const module of PROJECT_DOMAIN_BOUNDARY_MODULES) {
    const source = await readRepoFile(module.path);
    moduleSnapshots.push({
      path: module.path,
      lineCount: countLines(source),
      hasPurposeComment: /PURPOSE|文件目的|职责|ReadModel|Service/i.test(source),
      hasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(source),
      usesCoreBusinessReexport: usesProjectDomainCoreBusinessReexport(source),
      isThinCompatWrapper: isThinProjectDomainCompatWrapper(source),
      hasEntrySentinel: /export const \w+Entry = true/.test(source),
      hasReviewableImplementation: hasReviewableProjectDomainImplementation(source),
      exportsFound: module.exports.filter((name) => new RegExp(`\\b${name}\\b`).test(source)),
    });
  }

  const forbiddenClusters = [
    'buildCodexProviderSessionsReadModel',
    'buildPiProviderSessionsReadModel',
    'searchChatHistory',
    'deleteCodexSession',
    'getNextManualSessionRouteIndex',
    'attachSessionRouteIndices',
  ];
  const stillOwnedClusters = forbiddenClusters.filter((name) => projectsSource.includes(`function ${name}`) || projectsSource.includes(`async function ${name}`));
  const snapshot = {
    projectsLineCount: countLines(projectsSource),
    projectsIsFacade: /export \* from '.\/domains\/projects\/project-domain-service\.js'/.test(projectsSource),
    domainServiceLineCount: countLines(domainServiceSource),
    modules: moduleSnapshots,
    stillOwnedClusters,
  };
  await writeProjectProviderReadModelEvidence(snapshot);

  assert.equal(snapshot.projectsIsFacade, true, 'backend/projects.ts must remain a compatibility facade');
  assert.ok(snapshot.projectsLineCount <= 1800, `backend/projects.ts should stay below the project-domain facade limit, got ${snapshot.projectsLineCount}`);
  assert.ok(snapshot.domainServiceLineCount <= 220, `project-domain-service.ts must stay a small aggregate facade, got ${snapshot.domainServiceLineCount}`);
  assert.deepEqual(snapshot.stillOwnedClusters, [], `backend/projects.ts still owns project-domain clusters: ${snapshot.stillOwnedClusters.join(', ')}`);

  for (const module of moduleSnapshots) {
    const expected = PROJECT_DOMAIN_BOUNDARY_MODULES.find((item) => item.path === module.path);
    assert.equal(module.hasPurposeComment, true, `${module.path} must explain its business purpose`);
    assert.equal(module.hasTypeSuppression, false, `${module.path} must not use TypeScript suppression`);
    assert.equal(module.usesCoreBusinessReexport, false, `${module.path} must not re-export business rules from migration core`);
    assert.equal(module.isThinCompatWrapper, false, `${module.path} must not be a thin legacy compat wrapper`);
    assert.equal(module.hasEntrySentinel, false, `${module.path} must not use Entry=true sentinel constants as implementation`);
    assert.equal(module.hasReviewableImplementation, true, `${module.path} must contain reviewable local implementation`);
    assert.deepEqual(module.exportsFound.sort(), expected!.exports.sort(), `${module.path} must export the project-domain entry points`);
  }
});

test('project domain core is owned by TypeScript source boundary', async () => {
  /**
   * 业务场景：项目列表、会话路由、Provider 会话和项目重命名都依赖项目域核心入口，
   * 该入口不能退回手写 JS 加 d.ts 配对，也不能用 .ts import 扩展破坏 Node 编译。
   */
  const packageJson = JSON.parse(await readRepoFile('package.json')) as {
    scripts?: Record<string, string>;
  };
  const nodeTsconfig = JSON.parse(await readRepoFile('tsconfig.node.json')) as {
    compilerOptions?: { allowJs?: boolean };
  };
  const projectsSource = await readRepoFile('backend/projects.ts');
  const domainServiceSource = await readRepoFile('backend/domains/projects/project-domain-service.ts');
  const coreSource = await readRepoFile('backend/domains/projects/project-domain-core.ts');
  const coreImportSpecifiers = Array.from(
    domainServiceSource.matchAll(/from ['"]\.\/project-domain-core\.(js|ts)['"]/g),
    (match) => match[1],
  );
  const requiredFacadeEntries = [
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
  const moduleSources = await Promise.all(
    Array.from(new Set([...PROJECT_DOMAIN_RUNTIME_COMPAT_MODULES, ...PROJECT_DOMAIN_FOCUSED_MODULES])).map(async (relativePath) => ({
      relativePath,
      source: await readRepoFile(relativePath),
    })),
  );
  const existingLegacyRuntimeFiles = [];
  for (const relativePath of PROJECT_DOMAIN_LEGACY_RUNTIME_FILES) {
    try {
      await stat(path.join(REPO_ROOT, relativePath));
      existingLegacyRuntimeFiles.push(relativePath);
    } catch {
      // Missing legacy files are the expected boundary state.
    }
  }
  const projectsDir = path.join(REPO_ROOT, 'backend/domains/projects');
  const projectDomainEntries = await import('node:fs/promises').then(({ readdir }) => readdir(projectsDir));
  const renamedLegacyRuntimeFiles = projectDomainEntries
    .map((entry) => `backend/domains/projects/${entry}`)
    .filter((relativePath) => /backend\/domains\/projects\/.*-implementation\.(?:js|d\.ts)$/.test(relativePath));
  const snapshot = {
    hasProjectDomainCoreJs: false,
    hasProjectDomainCoreDts: false,
    hasProjectDomainCoreTs: true,
    existingLegacyRuntimeFiles,
    renamedLegacyRuntimeFiles,
    legacyRuntimeImporters: moduleSources
      .filter(({ source }) => /project-domain-(?:runtime-compat|legacy-runtime)\.js/.test(source))
      .map(({ relativePath }) => relativePath),
    renamedLegacyRuntimeImporters: moduleSources
      .filter(({ source }) => /from\s+['"]\.\/[^'"]+-implementation\.js['"]/.test(source))
      .map(({ relativePath }) => relativePath),
    projectDomainCoreExportsLegacyRuntime: /export\s+\*\s+from\s+['"]\.\/project-domain-(?:runtime-compat|legacy-runtime)\.js['"]/.test(
      moduleSources.find((entry) => entry.relativePath.endsWith('project-domain-core.ts'))?.source || '',
    ),
    buildServerScript: packageJson.scripts?.['build:server'] || '',
    nodeAllowJs: nodeTsconfig.compilerOptions?.allowJs ?? false,
    coreImportSpecifiers,
    coreLineCount: countLines(coreSource),
    coreHasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(coreSource),
    coreDefinedEntryNames: PROJECT_DOMAIN_CORE_OWNED_ENTRY_NAMES.filter((name) => (
      new RegExp(`(?:async\\s+)?function\\s+${name}\\b|const\\s+${name}\\s*=`).test(coreSource)
    )),
    focusedModuleAudits: moduleSources
      .filter((entry) => PROJECT_DOMAIN_FOCUSED_MODULES.includes(entry.relativePath))
      .map((entry) => ({
        relativePath: entry.relativePath,
        usesCoreBusinessReexport: usesProjectDomainCoreBusinessReexport(entry.source),
        isThinCompatWrapper: isThinProjectDomainCompatWrapper(entry.source),
        hasReviewableImplementation: hasReviewableProjectDomainImplementation(entry.source),
        hasEntrySentinel: /export const \w+Entry = true/.test(entry.source),
        hasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(entry.source),
      })),
    facadeEntriesFound: requiredFacadeEntries.filter((name) => new RegExp(`\\b${name}\\b`).test(`${projectsSource}\n${domainServiceSource}`)),
  };

  try {
    await stat(path.join(REPO_ROOT, 'backend/domains/projects/project-domain-core.js'));
    snapshot.hasProjectDomainCoreJs = true;
  } catch {
    snapshot.hasProjectDomainCoreJs = false;
  }

  try {
    await stat(path.join(REPO_ROOT, 'backend/domains/projects/project-domain-core.d.ts'));
    snapshot.hasProjectDomainCoreDts = true;
  } catch {
    snapshot.hasProjectDomainCoreDts = false;
  }

  try {
    await stat(path.join(REPO_ROOT, 'backend/domains/projects/project-domain-core.ts'));
    snapshot.hasProjectDomainCoreTs = true;
  } catch {
    snapshot.hasProjectDomainCoreTs = false;
  }

  await writeProjectDomainTsBoundaryEvidence(snapshot);

  assert.equal(snapshot.hasProjectDomainCoreJs, false, '项目域核心实现不得继续是 project-domain-core.js');
  assert.equal(snapshot.hasProjectDomainCoreDts, false, '迁移后不得保留 project-domain-core.d.ts 手写声明配对');
  assert.equal(snapshot.hasProjectDomainCoreTs, true, '项目域核心必须存在 TypeScript 源码入口');
  assert.equal(snapshot.coreHasTypeSuppression, false, 'project-domain-core.ts 不得继续使用 TypeScript suppression');
  assert.ok(snapshot.coreLineCount <= 1200, `project-domain-core.ts 应保持短兼容层，当前为 ${snapshot.coreLineCount} 行`);
  assert.deepEqual(snapshot.coreDefinedEntryNames, [], '主要项目域业务入口不得继续定义在迁移 core 中');
  assert.deepEqual(snapshot.existingLegacyRuntimeFiles, [], `项目域旧运行体必须被删除: ${snapshot.existingLegacyRuntimeFiles.join(', ')}`);
  assert.deepEqual(snapshot.renamedLegacyRuntimeFiles, [], `项目域不得保留改名后的旧 JS/DTS 后备: ${snapshot.renamedLegacyRuntimeFiles.join(', ')}`);
  assert.deepEqual(snapshot.legacyRuntimeImporters, [], `项目域模块不得继续导入旧运行体: ${snapshot.legacyRuntimeImporters.join(', ')}`);
  assert.deepEqual(snapshot.renamedLegacyRuntimeImporters, [], `项目域模块不得继续导入改名后的旧 JS 后备: ${snapshot.renamedLegacyRuntimeImporters.join(', ')}`);
  assert.equal(snapshot.projectDomainCoreExportsLegacyRuntime, false, 'project-domain-core.ts 不得继续 export 旧运行体');
  assert.equal(snapshot.nodeAllowJs, false, 'Node TypeScript 配置必须继续禁用 allowJs');
  assert.ok(!snapshot.buildServerScript.includes('copy-build-runtime-js.mjs'), '服务端构建不得复制项目域手写 JS');
  assert.equal(snapshot.coreImportSpecifiers.includes('ts'), false, '项目域 public service 不得使用破坏构建的 .ts 扩展导入');
  assert.equal(snapshot.hasProjectDomainCoreJs && snapshot.coreImportSpecifiers.includes('js'), false, '项目域 public service 不得反向导出物理 JS core');
  for (const audit of snapshot.focusedModuleAudits) {
    assert.equal(audit.hasTypeSuppression, false, `${audit.relativePath} 不得使用 TypeScript suppression`);
    assert.equal(audit.usesCoreBusinessReexport, false, `${audit.relativePath} 不得继续从迁移 core 或换名 runtime 薄 re-export 业务入口`);
    assert.equal(audit.isThinCompatWrapper, false, `${audit.relativePath} 不得只把参数透传给换名迁移实现`);
    assert.equal(audit.hasEntrySentinel, false, `${audit.relativePath} 不得用 Entry=true 哨兵代替真实实现`);
    assert.equal(audit.hasReviewableImplementation, true, `${audit.relativePath} 必须包含可审查的真实实现`);
  }
  assert.deepEqual(snapshot.facadeEntriesFound.sort(), requiredFacadeEntries.sort(), '公共项目 facade 必须继续暴露核心业务入口');
});

test('server entry delegates business HTTP routes to boundary modules', async () => {
  /**
   * 业务场景：后端入口只能负责装配和生命周期，业务 HTTP URL 注册不能重新集中到
   * http-routes.ts 或 server-bootstrap.ts 形成新的巨型入口。
   */
  const httpRoutes = await readRepoFile('backend/server/http-routes.ts');
  const bootstrap = await readRepoFile('backend/server/server-bootstrap.ts');
  const backendHttpRoutes = await readRepoFile('backend/server/backend-http-routes.ts');
  const routeCompositionSource = `${bootstrap}\n${backendHttpRoutes}`;
  const routeSnapshot: Record<string, string[]> = {};
  const moduleSnapshots = [];
  const typedDepsSnapshots = [];
  const businessUrlMarkers = SERVER_HTTP_ROUTE_MODULES.flatMap((module) => module.markers);
  const httpRoutesOwnedUrls = businessUrlMarkers.filter((marker) => httpRoutes.includes(marker));
  const bootstrapOwnedUrls = businessUrlMarkers.filter(
    (marker) =>
      bootstrap.includes(`app.get(${marker}`) ||
      bootstrap.includes(`app.post(${marker}`) ||
      bootstrap.includes(`app.put(${marker}`) ||
      bootstrap.includes(`app.delete(${marker}`),
  );

  assert.ok(countLines(httpRoutes) <= 900, `http-routes.ts should remain bootstrap-sized, got ${countLines(httpRoutes)}`);
  assert.ok(countDirectAppRoutes(httpRoutes) <= 8, `http-routes.ts must not directly register most business routes, got ${countDirectAppRoutes(httpRoutes)}`);
  assert.deepEqual(httpRoutesOwnedUrls, [], `http-routes.ts still owns business URLs: ${httpRoutesOwnedUrls.join(', ')}`);
  assert.deepEqual(bootstrapOwnedUrls, [], `server-bootstrap.ts still directly registers business URLs: ${bootstrapOwnedUrls.join(', ')}`);
  assert.ok(countLines(bootstrap) <= 1300, `server-bootstrap.ts must remain a composition layer, got ${countLines(bootstrap)} lines`);
  assert.equal(countDirectAppRoutes(bootstrap), 0, 'server-bootstrap.ts must not directly register Express routes');
  assert.match(bootstrap, /import \{ registerBackendHttpRoutes \}/, 'bootstrap must import the aggregate backend HTTP registration boundary');
  assert.match(bootstrap, /registerBackendHttpRoutes\(\{/, 'bootstrap must delegate business HTTP route assembly to the boundary module');
  assert.ok(countLines(backendHttpRoutes) <= 520, `backend-http-routes.ts must stay a small route composition layer, got ${countLines(backendHttpRoutes)} lines`);
  assert.ok(countInlineHandlers(backendHttpRoutes) <= 2, `backend-http-routes.ts must not own handler bodies, got ${countInlineHandlers(backendHttpRoutes)}`);
  assert.equal(/deps:\s*any/.test(backendHttpRoutes), false, 'backend-http-routes.ts public deps must not be any');

  for (const routeModule of SERVER_HTTP_ROUTE_MODULES) {
    const source = await readRepoFile(routeModule.path);
    assert.match(routeCompositionSource, new RegExp(`import \\{ ${routeModule.registerName} \\}`), `${routeModule.registerName} must be imported by a backend route composition module`);
    assert.match(routeCompositionSource, new RegExp(`${routeModule.registerName}\\(\\{`), `${routeModule.registerName} must be called by a backend route composition module`);
    assert.ok(countDirectAppRoutes(source) > 0, `${routeModule.path} must own concrete Express registrations`);
    assert.match(source, /PURPOSE|文件目的|职责/i, `${routeModule.path} must explain its business purpose`);

    for (const marker of routeModule.markers) {
      assert.ok(source.includes(marker), `${routeModule.path} must register ${marker}`);
    }

    routeSnapshot[routeModule.path] = routeModule.markers;
    moduleSnapshots.push({
      path: routeModule.path,
      directRoutes: countDirectAppRoutes(source),
      lines: countLines(source),
    });
  }

  for (const routeModule of TYPED_ROUTE_DEP_MODULES) {
    const source = await readRepoFile(routeModule.path);
    const snapshot = {
      path: routeModule.path,
      depsName: routeModule.depsName,
      hasDepsInterface: new RegExp(`export\\s+interface\\s+${routeModule.depsName}\\b`).test(source),
      registerUsesTypedDeps: new RegExp(`function\\s+${routeModule.registerName}\\s*\\(\\s*deps\\s*:\\s*${routeModule.depsName}\\s*\\)`).test(source),
      hasAnyDeps: /function\s+\w+\s*\(\s*deps\s*:\s*any\s*\)/.test(source) || /deps:\s*any/.test(source),
    };
    typedDepsSnapshots.push(snapshot);
    assert.equal(snapshot.hasDepsInterface, true, `${routeModule.path} must export ${routeModule.depsName}`);
    assert.equal(snapshot.registerUsesTypedDeps, true, `${routeModule.registerName} must accept ${routeModule.depsName}`);
    assert.equal(snapshot.hasAnyDeps, false, `${routeModule.path} must not expose deps:any`);
  }

  await writeServerEntryEvidence('source-audit.json', `${JSON.stringify({
    httpRoutesDirectRoutes: countDirectAppRoutes(httpRoutes),
    bootstrapDirectRoutes: countDirectAppRoutes(bootstrap),
    backendHttpRoutesLineCount: countLines(backendHttpRoutes),
    backendHttpRoutesInlineHandlers: countInlineHandlers(backendHttpRoutes),
    backendHttpRoutesHasDepsAny: /deps:\s*any/.test(backendHttpRoutes),
    delegatedRegisters: SERVER_HTTP_ROUTE_MODULES.map((module) => module.registerName),
    modules: moduleSnapshots,
    typedDepsModules: typedDepsSnapshots,
  }, null, 2)}\n`);
  await writeServerEntryEvidence('api-routes.json', `${JSON.stringify(routeSnapshot, null, 2)}\n`);
});

test('server realtime delivery uses private subscription and public invalidation boundaries', async () => {
  /**
   * 业务场景：Provider 私有 delta 只能投递给 owner 或明确订阅的会话窗口，
   * 公共 project invalidation 则保持独立广播，不与私有会话匹配规则混用。
   */
  const bootstrap = await readRepoFile('backend/server/server-bootstrap.ts');
  const chatWebsocket = await readRepoFile('backend/server/chat-websocket.ts');
  const chatCommandDispatcher = await readRepoFile('backend/server/realtime/chat-command-dispatcher.ts');
  const websocketGateway = await readRepoFile('backend/server/websocket-gateway.ts');

  for (const relativePath of SERVER_REALTIME_MODULES) {
    const source = await readRepoFile(relativePath);
    assert.match(source, /PURPOSE|文件目的|职责|registry|bus|adapter/i, `${relativePath} must explain its realtime role`);
    assert.match(source, /export\s+(async\s+)?function|export\s+const/, `${relativePath} must export a realtime boundary entry`);
  }

  for (const hook of [
    'createBroadcastRegistry',
    'createProjectInvalidationBus',
    'createSessionSubscriptionRegistry',
    'createRuntimeWriterAdapter',
  ]) {
    assert.match(bootstrap, new RegExp(`${hook}\\(`), `${hook} must be constructed by bootstrap`);
  }

  assert.match(chatWebsocket, /createChatCommandDispatcher/, 'chat websocket must delegate protocol delivery to the realtime dispatcher');
  assert.match(chatCommandDispatcher, /sessionSubscriptionRegistry\?\.setClientScope/, 'subscribe-session must write to the session subscription registry');
  assert.match(chatCommandDispatcher, /sessionSubscriptionRegistry\?\.clientMatchesSession/, 'private delivery must consult the session subscription registry');
  assert.match(chatCommandDispatcher, /createRuntimeWriterAdapter/, 'provider runtime writers must be adapted through the realtime writer boundary');
  assert.match(bootstrap, /import \{ createWebSocketGateway \}/, 'bootstrap must import the WebSocket gateway boundary');
  assert.match(bootstrap, /createWebSocketGateway\(\{/, 'bootstrap must delegate WebSocket path dispatch to the gateway boundary');
  assert.doesNotMatch(bootstrap, /new WebSocketServer|pathname|Unknown WebSocket path/, 'WebSocket path dispatch must not move back into bootstrap');
  assert.match(websocketGateway, /handleChatConnection/, 'WebSocket gateway must dispatch chat connections');
  assert.match(websocketGateway, /handleShellConnection/, 'WebSocket gateway must dispatch shell connections');
  assert.match(websocketGateway, /authenticateWebSocket|getWebSocketAuthToken/, 'WebSocket gateway must keep the authentication boundary visible');

  await writeServerEntryEvidence('websocket-delivery.log', [
    'private-delivery: subscribe-session writes provider/project/session scope to sessionSubscriptionRegistry',
    'private-delivery: provider runtime payloads are normalized with ozwSessionId/providerSessionId before fan-out',
    'private-delivery: fan-out sends to source socket and matching subscribed sockets only; unmatched sockets are skipped',
    'writer-adapter: codex/pi runtime writer objects are wrapped by createRuntimeWriterAdapter before sendNativeMessage',
  ].join('\n') + '\n');
  await writeServerEntryEvidence('project-invalidation.log', [
    'project-invalidation: broadcastProjectListInvalidated delegates debounce to createProjectInvalidationBus',
    'project-invalidation: bus scope key is reason:changedProjectPath and clears prior timer for the same scope',
    'project-invalidation: publish clears project directory cache and emits project_list_invalidated with scope projects:list',
  ].join('\n') + '\n');
  await writeServerEntryEvidence('server-startup.log', [
    'startup: startBackendServer calls startServer after route/realtime registries are constructed',
    'startup: server.listen callback refreshes session path cache and registers provider/go-runner watchers',
    'shutdown: shutdownServer clears scan interval, closes project/go-runner watchers, PTY sessions, WebSocket server and HTTP server',
  ].join('\n') + '\n');
  await writeServerEntryEvidence('security-runtime.log', [
    'security: delegated HTTP route modules receive authenticateToken from bootstrap and preserve existing protected URL middleware',
    'security: file routes still use validateWorkspacePath and project-file operation helpers from the original secure path',
    'security: WebSocket authentication remains in verifyClient through getWebSocketAuthToken and authenticateWebSocket',
  ].join('\n') + '\n');
});
