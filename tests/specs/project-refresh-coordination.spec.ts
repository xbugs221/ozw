// Sources: 2026-06-12-103-多窗口刷新协同和重任务限流, 2026-06-16-15-前端项目状态Hook拆分
// @ts-nocheck -- Spec fixture uses focused in-memory transports for browser-window coordination contracts.
/**
 * PURPOSE: Verify ozw coordinates project refreshes across browser windows and
 * coalesces duplicate backend heavy reads by business scope.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results', 'project-refresh-coordination');

/**
 * Read repository source text for structural business-boundary assertions.
 */
async function readRepoSource(relativePath) {
  /**
   * PURPOSE: Keep frontend project-state ownership checks close to the refresh
   * coordination specs that depend on these modules staying separated.
   */
  return fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Create an in-memory cross-window transport for the frontend coordinator.
 */
function createMemoryTransportHub() {
  /**
   * PURPOSE: Exercise the same publish/subscribe semantics expected from
   * BroadcastChannel without requiring a real browser in this spec test.
   */
  const subscribers = new Map();
  const messages = [];

  return {
    messages,
    connect(windowId) {
      /**
       * PURPOSE: Give each simulated window an isolated endpoint while sharing
       * one message bus.
       */
      return {
        postMessage(message) {
          messages.push({ from: windowId, message });
          for (const [targetWindowId, handler] of subscribers.entries()) {
            if (targetWindowId !== windowId) {
              queueMicrotask(() => handler({ ...message, sourceWindowId: windowId }));
            }
          }
        },
        subscribe(handler) {
          subscribers.set(windowId, handler);
          return () => subscribers.delete(windowId);
        },
      };
    },
  };
}

/**
 * Wait for queued cross-window messages to be delivered.
 */
async function flushTransport() {
  /**
   * PURPOSE: Keep assertions deterministic after queueMicrotask delivery.
   */
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Create a deferred promise so tests can observe in-flight coalescing.
 */
function createDeferred() {
  /**
   * PURPOSE: Hold a backend task open long enough to prove duplicate calls
   * share one in-flight promise.
   */
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

test('多窗口项目刷新由可见 owner 执行，隐藏 follower 复用项目快照', async () => {
  const { createWindowRefreshCoordinator } = await import('../../frontend/utils/windowRefreshCoordinator.ts');
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  let now = Date.parse('2026-06-11T01:00:00.000Z');
  const hub = createMemoryTransportHub();
  const visibleWindow = createWindowRefreshCoordinator({
    windowId: 'visible-window',
    transport: hub.connect('visible-window'),
    isVisible: () => true,
    now: () => now,
    ownerTtlMs: 5000,
  });
  const hiddenWindow = createWindowRefreshCoordinator({
    windowId: 'hidden-window',
    transport: hub.connect('hidden-window'),
    isVisible: () => false,
    now: () => now,
    ownerTtlMs: 5000,
  });

  await visibleWindow.start?.();
  await hiddenWindow.start?.();
  await flushTransport();

  const invalidation = {
    type: 'project_list_invalidated',
    scope: 'projects:list',
    reason: 'watcher:session-change',
    changedProjectPath: '/tmp/ozw-refresh-coordination/project-a',
    version: 'projects-v1',
  };
  const visibleDecision = await visibleWindow.requestProjectRefresh(invalidation);
  const hiddenDecision = await hiddenWindow.requestProjectRefresh(invalidation);

  assert.equal(visibleDecision.shouldRun, true, '可见窗口必须成为项目刷新 owner');
  assert.equal(hiddenDecision.shouldRun, false, '隐藏窗口不能执行同一项目重刷新');
  assert.equal(hiddenDecision.ownerWindowId, 'visible-window');

  await visibleWindow.publishProjectsSnapshot({
    scope: 'projects:list',
    version: 'projects-v1',
    sourceWindowId: 'visible-window',
    projects: [{ name: 'project-a', fullPath: '/tmp/ozw-refresh-coordination/project-a', sessionCount: 3 }],
  });
  await flushTransport();

  const followerSnapshot = hiddenWindow.getProjectsSnapshot('projects:list');
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'window-refresh-coordination-state.json'),
    `${JSON.stringify({ visibleDecision, hiddenDecision, followerSnapshot, busMessages: hub.messages }, null, 2)}\n`,
    'utf8',
  );

  assert.equal(followerSnapshot.version, 'projects-v1');
  assert.equal(followerSnapshot.sourceWindowId, 'visible-window');
  assert.equal(followerSnapshot.projects.length, 1);

  await visibleWindow.dispose?.();
  await hiddenWindow.dispose?.();
  now += 1;
});

test('同一 invalidation 的两个可见窗口只能选出一个刷新 owner', async () => {
  const { createWindowRefreshCoordinator } = await import('../../frontend/utils/windowRefreshCoordinator.ts');

  let now = Date.parse('2026-06-11T01:05:00.000Z');
  const hub = createMemoryTransportHub();
  const firstWindow = createWindowRefreshCoordinator({
    windowId: 'visible-a',
    transport: hub.connect('visible-a'),
    isVisible: () => true,
    now: () => now,
    ownerTtlMs: 5000,
    electionDelayMs: 1,
  });
  const secondWindow = createWindowRefreshCoordinator({
    windowId: 'visible-b',
    transport: hub.connect('visible-b'),
    isVisible: () => true,
    now: () => now,
    ownerTtlMs: 5000,
    electionDelayMs: 1,
  });

  await firstWindow.start?.();
  await secondWindow.start?.();

  const invalidation = {
    type: 'project_list_invalidated',
    scope: 'projects:list',
    reason: 'watcher:project-list',
    version: 'projects-visible-race',
  };
  const [firstDecision, secondDecision] = await Promise.all([
    firstWindow.requestProjectRefresh(invalidation),
    secondWindow.requestProjectRefresh(invalidation),
  ]);

  const owners = [firstDecision, secondDecision].filter((decision) => decision.shouldRun);
  assert.equal(owners.length, 1, '同一 scope/version 的并发可见窗口只能有一个 owner');
  assert.equal(firstDecision.ownerWindowId, secondDecision.ownerWindowId);

  const ownerWindow = firstDecision.shouldRun ? firstWindow : secondWindow;
  const followerWindow = firstDecision.shouldRun ? secondWindow : firstWindow;
  await ownerWindow.publishProjectsSnapshot({
    scope: 'projects:list',
    version: 'projects-visible-race',
    projects: [{ name: 'project-race', fullPath: '/tmp/ozw-refresh-coordination/project-race' }],
  });
  await flushTransport();

  const followerSnapshot = await followerWindow.waitForProjectsSnapshot?.('projects:list', 1);
  assert.equal(followerSnapshot?.version, 'projects-visible-race');

  await firstWindow.dispose?.();
  await secondWindow.dispose?.();
  now += 1;
});

test('同一 scope 的新 invalidation 不能复用旧版本项目快照', async () => {
  const { createWindowRefreshCoordinator } = await import('../../frontend/utils/windowRefreshCoordinator.ts');

  let now = Date.parse('2026-06-11T01:10:00.000Z');
  const hub = createMemoryTransportHub();
  const visibleWindow = createWindowRefreshCoordinator({
    windowId: 'visible-version-owner',
    transport: hub.connect('visible-version-owner'),
    isVisible: () => true,
    now: () => now,
    ownerTtlMs: 5000,
    electionDelayMs: 1,
  });
  const hiddenWindow = createWindowRefreshCoordinator({
    windowId: 'hidden-version-follower',
    transport: hub.connect('hidden-version-follower'),
    isVisible: () => false,
    now: () => now,
    ownerTtlMs: 5000,
    snapshotWaitMs: 50,
  });

  await visibleWindow.start?.();
  await hiddenWindow.start?.();

  await visibleWindow.requestProjectRefresh({ type: 'project_list_invalidated', scope: 'projects:list', version: 'projects-version-v1' });
  await hiddenWindow.requestProjectRefresh({ type: 'project_list_invalidated', scope: 'projects:list', version: 'projects-version-v1' });
  await visibleWindow.publishProjectsSnapshot({
    scope: 'projects:list',
    version: 'projects-version-v1',
    projects: [{ name: 'old', fullPath: '/tmp/ozw-refresh-coordination/old' }],
  });
  await flushTransport();
  assert.equal(hiddenWindow.getProjectsSnapshot('projects:list', 'projects-version-v1')?.projects?.[0]?.name, 'old');

  await visibleWindow.requestProjectRefresh({ type: 'project_list_invalidated', scope: 'projects:list', version: 'projects-version-v2' });
  const hiddenDecision = await hiddenWindow.requestProjectRefresh({
    type: 'project_list_invalidated',
    scope: 'projects:list',
    version: 'projects-version-v2',
  });
  assert.equal(hiddenDecision.shouldRun, false);
  assert.equal(hiddenWindow.getProjectsSnapshot('projects:list', 'projects-version-v2'), null);

  const pendingV2Snapshot = hiddenWindow.waitForProjectsSnapshot?.('projects:list', 50, 'projects-version-v2');
  await visibleWindow.publishProjectsSnapshot({
    scope: 'projects:list',
    version: 'projects-version-v2',
    projects: [{ name: 'new', fullPath: '/tmp/ozw-refresh-coordination/new' }],
  });
  await flushTransport();

  const v2Snapshot = await pendingV2Snapshot;
  assert.equal(v2Snapshot?.version, 'projects-version-v2');
  assert.equal(v2Snapshot?.projects?.[0]?.name, 'new');

  await visibleWindow.dispose?.();
  await hiddenWindow.dispose?.();
  now += 1;
});

test('后端相同 scope 的重任务并发合并，失败后可重试', async () => {
  const { createScopedAsyncCoalescer } = await import('../../backend/utils/scopedAsyncCoalescer.ts');
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const coalescer = createScopedAsyncCoalescer({ now: () => Date.now(), label: 'project-refresh-heavy-read' });

  let projectListExecutions = 0;
  const projectListDeferred = createDeferred();
  const firstProjectList = coalescer.run('projects:list:user:default', async () => {
    projectListExecutions += 1;
    return projectListDeferred.promise;
  });
  const secondProjectList = coalescer.run('projects:list:user:default', async () => {
    projectListExecutions += 1;
    return { projects: [{ name: 'should-not-run' }] };
  });

  await Promise.resolve();
  assert.equal(projectListExecutions, 1, '同 scope 并发项目清单读取只能执行一次真实 task');

  const projectResult = { projects: [{ name: 'project-a' }], version: 'projects-v1' };
  projectListDeferred.resolve(projectResult);
  const [firstResult, secondResult] = await Promise.all([firstProjectList, secondProjectList]);
  assert.deepEqual(firstResult, projectResult);
  assert.deepEqual(secondResult, projectResult);

  const thirdResult = await coalescer.run('projects:list:user:default', async () => {
    projectListExecutions += 1;
    return { projects: [{ name: 'project-a' }], version: 'projects-v2' };
  });
  assert.equal(projectListExecutions, 2, 'settle 后下一次刷新必须重新执行真实 task');
  assert.equal(thirdResult.version, 'projects-v2');

  let independentExecutions = 0;
  await Promise.all([
    coalescer.run('projects:overview:/tmp/ozw-refresh-coordination/project-a', async () => {
      independentExecutions += 1;
      return { overview: true };
    }),
    coalescer.run('search:sessions:user:default:query-hash', async () => {
      independentExecutions += 1;
      return { matches: [] };
    }),
  ]);
  assert.equal(independentExecutions, 2, '不同 scope 不能被错误合并或阻塞');

  let failingExecutions = 0;
  await assert.rejects(
    coalescer.run('search:sessions:user:default:failing-query', async () => {
      failingExecutions += 1;
      throw new Error('temporary search failure');
    }),
    /temporary search failure/,
  );
  const retryResult = await coalescer.run('search:sessions:user:default:failing-query', async () => {
    failingExecutions += 1;
    return { matches: ['retry-ok'] };
  });
  assert.deepEqual(retryResult, { matches: ['retry-ok'] });
  assert.equal(failingExecutions, 2, '失败 scope 不能缓存错误，下一次必须能重试');

  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'backend-coalescer-state.json'),
    `${JSON.stringify({
      projectListExecutions,
      independentExecutions,
      failingExecutions,
      thirdResult,
      retryResult,
      stats: coalescer.getStats?.() || null,
    }, null, 2)}\n`,
    'utf8',
  );
});

test('project state hook delegates route, session collection, and refresh rules', async () => {
  const hookPath = 'frontend/hooks/useProjectsState.ts';
  const hookSource = await readRepoSource(hookPath);
  const requiredModules = [
    'frontend/hooks/projects/projectRouteSelection.ts',
    'frontend/hooks/projects/projectSessionCollections.ts',
    'frontend/hooks/projects/projectRefreshReducer.ts',
  ];
  const snapshot = {
    hookLineCount: hookSource.split(/\r?\n/).length,
    modules: requiredModules.map((modulePath) => ({
      path: modulePath,
      exists: existsSync(path.join(REPO_ROOT, modulePath)),
      importedByHook: hookSource.includes(`./projects/${path.basename(modulePath, '.ts')}`),
    })),
    legacyRouteRegexCount: (hookSource.match(/\/session\/\(\[\^\/\]\+\)|\/session\/\(\[\^\/\]\+\)|\^\\\/session\\\//g) || []).length,
  };

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'project-state-hook-split-audit.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );

  assert.ok(snapshot.hookLineCount <= 950, `useProjectsState.ts 应收敛为组合 hook，当前 ${snapshot.hookLineCount} 行`);
  for (const module of snapshot.modules) {
    assert.equal(module.exists, true, `${module.path} 必须存在`);
    assert.equal(module.importedByHook, true, `useProjectsState.ts 必须导入 ${module.path}`);
  }
});

test('project state split modules expose the business entry points used by navigation', async () => {
  const expectedExports = [
    ['frontend/hooks/projects/projectRouteSelection.ts', ['resolveRouteSelection', 'findWorkflowChildSessionForRoute']],
    ['frontend/hooks/projects/projectSessionCollections.ts', ['getProjectSessions', 'insertSessionIntoProject']],
    ['frontend/hooks/projects/projectRefreshReducer.ts', ['mergeProjectOverview', 'mergeProjectSummaries']],
  ];

  for (const [modulePath, exports] of expectedExports) {
    assert.equal(existsSync(path.join(REPO_ROOT, modulePath)), true, `${modulePath} 必须存在`);
    const source = await readRepoSource(modulePath);
    assert.match(source, /PURPOSE|目的|project|session|route|refresh/i, `${modulePath} 必须说明业务目的`);
    for (const exportName of exports) {
      assert.match(source, new RegExp(`export\\s+(function|const)\\s+${exportName}\\b`), `${modulePath} 必须导出 ${exportName}`);
    }
  }
});
