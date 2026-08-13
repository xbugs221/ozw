/**
 * PURPOSE: Protect the project-list first-byte path from optional provider
 * history scans that become minute-long operations on slow VPS storage.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { registerProjectRoutes } from '../../backend/server/http/project-routes.ts';

type RouteHandler = (req: Record<string, unknown>, res: Record<string, any>) => Promise<unknown>;

/**
 * Register project handlers with one deliberately slow Hermes reader.
 */
function createRouteFixture() {
  /** PURPOSE: Exercise the real route orchestration without starting the complete backend. */
  const routes = new Map<string, RouteHandler>();
  const invalidations: Array<Record<string, unknown>> = [];
  let hermesReadStarted = false;
  let watcherRegistrationStarted = false;
  let releaseHermes: ((value: { sessions: unknown[]; diagnostics: unknown[] }) => void) | null = null;
  const hermesResult = new Promise<{ sessions: unknown[]; diagnostics: unknown[] }>((resolve) => {
    releaseHermes = resolve;
  });
  const slowReadFallback = setTimeout(() => {
    /** PURPOSE: Make a regression fail on latency instead of leaving the test process hung. */
    releaseHermes?.({ sessions: [{ id: 'hermes-timeout' }], diagnostics: [] });
  }, 250);
  const app = {
    get(path: string, ...handlers: RouteHandler[]) {
      routes.set(`GET ${path}`, handlers.at(-1) as RouteHandler);
    },
    put() {},
    post() {},
    delete() {},
  };

  registerProjectRoutes({
    app: app as any,
    authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
    heavyReadCoalescer: {
      async run<T>(_key: string, work: () => T | Promise<T>): Promise<T> {
        return work();
      },
    },
    getProjects: async () => [{ name: 'demo', displayName: 'Demo', path: '/demo', fullPath: '/demo', routePath: '/demo' }],
    broadcastProgress: null,
    summarizeProjectForList: (project) => project,
    ensureGoRunnerWatchersForProjects: async () => {
      watcherRegistrationStarted = true;
    },
    watchGoWorkflowRun: async () => {},
    resolveProjectOverviewTarget: async () => null,
    buildProjectOverviewReadModel: async (project) => project,
    attachWorkflowMetadata: async (projects) => projects,
    getCodexSessions: async () => [],
    getPiSessions: async () => [],
    getClaudeSessions: async () => [],
    extractProjectDirectory: async () => '',
    renameProject: async () => {},
    deleteProject: async () => {},
    addProjectManually: async () => ({}),
    broadcastProjectListInvalidated: (event) => invalidations.push(event),
    listUnscopedHermesSessions: async () => {
      hermesReadStarted = true;
      return hermesResult;
    },
  });

  return {
    handler: routes.get('GET /api/projects') as RouteHandler,
    invalidations,
    hermesReadStarted: () => hermesReadStarted,
    watcherRegistrationStarted: () => watcherRegistrationStarted,
    releaseHermes(value: { sessions: unknown[]; diagnostics: unknown[] }) {
      /** PURPOSE: Complete the simulated slow read and remove its regression watchdog. */
      clearTimeout(slowReadFallback);
      releaseHermes?.(value);
    },
  };
}

/**
 * Invoke the list handler and capture its JSON body.
 */
async function invokeProjectList(handler: RouteHandler): Promise<unknown[]> {
  /** PURPOSE: Measure handler completion independently from the background provider scan. */
  let responseBody: unknown[] = [];
  await handler({}, {
    json(body: unknown[]) {
      responseBody = body;
    },
    status() {
      return this;
    },
  });
  return responseBody;
}

test('项目首页先返回 SQLite 摘要，再后台补齐慢盘 Hermes 集合', async () => {
  /** A slow optional provider must not delay first response or disappear permanently. */
  const fixture = createRouteFixture();
  const startedAt = performance.now();
  const initial = await invokeProjectList(fixture.handler);
  const initialElapsedMs = performance.now() - startedAt;

  assert.ok(initialElapsedMs < 50, `lightweight list took ${initialElapsedMs.toFixed(1)}ms`);
  assert.equal(fixture.hermesReadStarted(), false, 'provider scan must start after the response turn');
  assert.equal(fixture.watcherRegistrationStarted(), false, 'watcher setup must start after the response turn');
  assert.deepEqual(initial.map((project: any) => project.name), ['demo']);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.hermesReadStarted(), true);
  assert.equal(fixture.watcherRegistrationStarted(), true);
  fixture.releaseHermes({ sessions: [{ id: 'hermes-1' }], diagnostics: [] });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(fixture.invalidations, [{ reason: 'hermes-unscoped-refresh' }]);
  const refreshed = await invokeProjectList(fixture.handler);
  assert.deepEqual(refreshed.map((project: any) => project.name), ['demo', 'hermes-unscoped']);
  assert.equal((refreshed[1] as any).sessionMeta.total, 1);
});
