// @ts-nocheck -- Route registration tests use minimal Express-like doubles.
/**
 * PURPOSE: Verify project overview refreshes the current project's workflow
 * index before returning workflow cards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { registerProjectRoutes } from '../../backend/server/http/project-routes.ts';

/**
 * Build the smallest Express response double needed by route handlers.
 */
function createResponseRecorder() {
  /**
   * PURPOSE: Capture status and JSON payload from an Express-style handler.
   */
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('project overview synchronizes workflow index before building cards', async () => {
  const routes = new Map();
  const projectPath = '/home/zzl/projects/matx_proj/matx';
  const calls = [];

  registerProjectRoutes({
    app: {
      get(routePath, _auth, handler) {
        routes.set(`GET ${routePath}`, handler);
      },
      put(routePath, _auth, handler) {
        routes.set(`PUT ${routePath}`, handler);
      },
      delete(routePath, _auth, handler) {
        routes.set(`DELETE ${routePath}`, handler);
      },
      post(routePath, _auth, handler) {
        routes.set(`POST ${routePath}`, handler);
      },
    },
    authenticateToken: (_req, _res, next) => next?.(),
    heavyReadCoalescer: {
      async run(_key, fn) {
        return fn();
      },
    },
    async getProjects() {
      return [];
    },
    async broadcastProgress() {},
    summarizeProjectForList(project = {}) {
      return { name: project.name, fullPath: project.fullPath, path: project.path };
    },
    async ensureGoRunnerWatchersForProjects() {},
    async watchGoWorkflowRun() {},
    async resolveProjectOverviewTarget(projectName, requestedProjectPath) {
      calls.push(['resolve', projectName, requestedProjectPath]);
      return { name: projectName, fullPath: projectPath, path: projectPath };
    },
    async syncProjectWorkflowOverviewIndex(syncedProjectPath) {
      calls.push(['sync', syncedProjectPath]);
    },
    async buildProjectOverviewReadModel(project) {
      calls.push(['build', project.fullPath]);
      return {
        name: project.name,
        fullPath: project.fullPath,
        workflows: [{ id: 'run-active', runState: 'running' }],
      };
    },
    async attachWorkflowMetadata(projects) {
      return projects;
    },
    async getCodexSessions() {
      return [];
    },
    async getPiSessions() {
      return [];
    },
    async extractProjectDirectory() {
      return projectPath;
    },
    async renameProject() {},
    async deleteProject() {},
    async addProjectManually() {
      return {};
    },
    async broadcastProjectListInvalidated() {},
  });

  const handler = routes.get('GET /api/projects/:projectName/overview');
  assert.equal(typeof handler, 'function');

  const response = createResponseRecorder();
  await handler({
    params: { projectName: 'matx-a27c1571' },
    query: { projectPath },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [
    ['resolve', 'matx-a27c1571', projectPath],
    ['sync', projectPath],
    ['build', projectPath],
  ]);
  assert.deepEqual(response.payload.workflows, [{ id: 'run-active', runState: 'running' }]);
});
