// @ts-nocheck -- Route registration tests use minimal Express-like doubles.
/**
 * PURPOSE: Verify workflow HTTP routes honor explicit projectPath values for
 * projects whose UI names cannot be reversed into filesystem paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { registerWorkflowRoutes } from '../../backend/server/http/workflow-routes.ts';

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

test('workflow list route uses explicit projectPath for hash-derived project names', async () => {
  const routes = new Map();
  const requestedProjectPath = '/home/zzl/projects/matx_proj/matx';
  const invalidDerivedPath = '/home/zzl/projects/matx-a27c1571';
  const listCalls = [];

  registerWorkflowRoutes({
    app: {
      get(routePath, _auth, handler) {
        routes.set(`GET ${routePath}`, handler);
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
    fsPromises: {
      async stat(projectPath) {
        if (projectPath !== requestedProjectPath) {
          throw new Error(`unexpected project path: ${projectPath}`);
        }
        return { isDirectory: () => true };
      },
    },
    async extractProjectDirectory() {
      return invalidDerivedPath;
    },
    async listProjectWorkflows(projectPath) {
      listCalls.push(projectPath);
      return [{ id: 'run-active', runId: 'run-active', title: 'active workflow', runState: 'running' }];
    },
    summarizeWorkflowForProjectList(workflow) {
      return workflow;
    },
    async getProjects() {
      return [];
    },
    async attachWorkflowMetadata(projects) {
      return projects;
    },
    findProjectByName() {
      return null;
    },
    async createProjectWorkflow() {
      throw new Error('not used');
    },
    async watchGoWorkflowRun() {},
    async broadcastProjectListInvalidated() {},
    async listProjectAdoptableOpenSpecChanges() {
      return [];
    },
    async getProjectWorkflow() {
      return null;
    },
    async resumeWorkflowRun() {
      return null;
    },
    async abortWorkflowRun() {
      return null;
    },
  });

  const handler = routes.get('GET /api/projects/:projectName/workflows');
  assert.equal(typeof handler, 'function');

  const response = createResponseRecorder();
  await handler({
    params: { projectName: 'matx-a27c1571' },
    query: { projectPath: requestedProjectPath },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(listCalls, [requestedProjectPath]);
  assert.deepEqual(response.payload, [
    { id: 'run-active', runId: 'run-active', title: 'active workflow', runState: 'running' },
  ]);
});
