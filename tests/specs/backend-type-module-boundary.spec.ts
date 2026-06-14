/**
 * Sources: 2026-06-11-95-压缩后端类型和巨型模块债, 2026-06-13-109-项目Provider会话读模型拆分, 2026-06-14-110-压薄后端legacy-server边界, 2026-06-14-113-Codex-app-server-runtime可测化
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
  'backend/openai-codex.ts',
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
    readRepoFile('backend/openai-codex.ts'),
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
