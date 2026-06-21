// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Pin non-streaming agent route internals that adapt Codex writer
 * events and clean up temporary cloned repositories.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

const originalHome = process.env.HOME;
const originalDatabasePath = process.env.DATABASE_PATH;
const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-agent-route-test-'));

process.env.HOME = tempHome;
process.env.DATABASE_PATH = path.join(tempHome, 'auth.db');

const { initializeDatabase } = await import('../../backend/database/db.ts');
await initializeDatabase();

const {
  default: agentRouter,
  __agentRouteInternalsForTest: {
    ResponseCollector,
    createAgentRouter,
    cleanupProject,
    isCbwExternalProjectPath,
  },
} = await import('../../backend/routes/agent.ts');
const {
  __agentSessionRunnerInternalsForTest: {
    createTerminalAwareWriter,
  },
} = await import('../../backend/domains/agent/agent-session-runner.ts');

/**
 * Check whether a path still exists.
 */
async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a minimal HTTP server around the agent router under test.
 */
async function startAgentRouteApp(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', router);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

/**
 * Close an HTTP server and await shutdown.
 */
async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test.after(async () => {
  if (originalHome) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }

  if (originalDatabasePath) {
    process.env.DATABASE_PATH = originalDatabasePath;
  } else {
    delete process.env.DATABASE_PATH;
  }

  await fs.rm(tempHome, { recursive: true, force: true });
});

test('non-streaming /api/agent collector returns Codex assistant messages and token usage', () => {
  const collector = new ResponseCollector();
  const contextBudget = {
    used: 22,
    total: 200000,
    remaining: 199978,
    usedPercent: 0,
    remainingPercent: 100,
    source: 'codex-turn-completed-fallback',
  };

  collector.send({
    type: 'status',
    message: 'Session started',
    projectPath: '/tmp/project',
  });
  collector.send(JSON.stringify({
    type: 'session-created',
    sessionId: 'codex-thread-1',
    provider: 'codex',
  }));
  collector.send(JSON.stringify({
    type: 'codex-response',
    sessionId: 'codex-thread-1',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'msg-1',
      message: {
        role: 'assistant',
        content: 'draft answer',
      },
    },
  }));
  collector.send(JSON.stringify({
    type: 'codex-response',
    sessionId: 'codex-thread-1',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'msg-1',
      message: {
        role: 'assistant',
        content: 'final answer',
        phase: 'final',
      },
    },
  }));
  collector.send(JSON.stringify({
    type: 'codex-response',
    sessionId: 'codex-thread-1',
    data: {
      type: 'turn_complete',
      usage: {
        input_tokens: 12,
        cached_input_tokens: 3,
        output_tokens: 5,
        reasoning_output_tokens: 2,
        total_tokens: 22,
      },
    },
  }));
  collector.send(JSON.stringify({
    type: 'token-budget',
    sessionId: 'codex-thread-1',
    data: contextBudget,
  }));

  assert.equal(collector.getSessionId(), 'codex-thread-1');
  assert.deepEqual(collector.getAssistantMessages(), [
    {
      role: 'assistant',
      content: 'final answer',
      phase: 'final',
    },
  ]);
  assert.deepEqual(collector.getTotalTokens(), {
    inputTokens: 12,
    outputTokens: 5,
    cacheReadTokens: 3,
    cacheCreationTokens: 0,
    reasoningOutputTokens: 2,
    totalTokens: 22,
    contextBudget,
  });
});

test('agent route runtime waits for Codex app-server completion before summarizing response', async () => {
  const collector = new ResponseCollector();
  const terminalAware = createTerminalAwareWriter(collector);
  let completed = false;
  const waitForCompletion = terminalAware.waitForTerminalEvent().then(() => {
    completed = true;
  });

  terminalAware.writer.send({
    type: 'session-created',
    sessionId: 'codex-thread-route',
    provider: 'codex',
  });
  terminalAware.writer.send({
    type: 'message-accepted',
    sessionId: 'codex-thread-route',
    provider: 'codex',
  });
  await Promise.resolve();

  assert.equal(completed, false, 'route must not complete after app-server only accepts the turn');
  assert.deepEqual(collector.getAssistantMessages(), []);

  terminalAware.writer.send({
    type: 'codex-response',
    sessionId: 'codex-thread-route',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'msg-route',
      message: {
        role: 'assistant',
        content: 'completed route answer',
      },
    },
  });
  terminalAware.writer.send({
    type: 'codex-complete',
    sessionId: 'codex-thread-route',
    actualSessionId: 'codex-thread-route',
  });
  await waitForCompletion;

  assert.equal(completed, true);
  assert.deepEqual(collector.getAssistantMessages(), [
    {
      role: 'assistant',
      content: 'completed route answer',
    },
  ]);
});

test('agent route runtime fails the request on Codex app-server terminal error', async () => {
  const collector = new ResponseCollector();
  const terminalAware = createTerminalAwareWriter(collector);
  const waitForCompletion = terminalAware.waitForTerminalEvent();

  terminalAware.writer.send({
    type: 'codex-error',
    sessionId: 'codex-thread-route',
    error: 'runtime failed',
  });

  await assert.rejects(waitForCompletion, /runtime failed/);
});

test('POST /api/agent rejects missing and invalid API keys outside platform mode', async () => {
  const { server, baseUrl } = await startAgentRouteApp(agentRouter);

  try {
    const missingKeyResponse = await fetch(`${baseUrl}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: tempHome,
        message: 'route auth regression',
        stream: false,
      }),
    });
    assert.equal(missingKeyResponse.status, 401);
    assert.deepEqual(await missingKeyResponse.json(), { error: 'API key required' });

    const invalidKeyResponse = await fetch(`${baseUrl}/api/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'ck_invalid',
      },
      body: JSON.stringify({
        projectPath: tempHome,
        message: 'route auth regression',
        stream: false,
      }),
    });
    assert.equal(invalidKeyResponse.status, 401);
    assert.deepEqual(await invalidKeyResponse.json(), { error: 'Invalid or inactive API key' });
  } finally {
    await closeServer(server);
  }
});

test('POST /api/agent validates existing project path before execution and returns completed response', async () => {
  const projectDir = path.join(tempHome, 'workspace-project');
  await fs.mkdir(projectDir, { recursive: true });

  const observed = {
    resolverInput: null,
    runnerProjectPath: null,
    order: [],
  };

  const injectedRouter = createAgentRouter({
    validateExternalApiKey(req, _res, next) {
      req.user = { id: 1 };
      next();
    },
    async resolveAgentProjectPath(projectPath) {
      observed.order.push('resolve');
      observed.resolverInput = projectPath;
      await fs.access(projectPath);
      return await fs.realpath(projectPath);
    },
    async runAgentSession(request, writer) {
      observed.order.push('run');
      observed.runnerProjectPath = request.projectPath;
      writer.setSessionId('codex-thread-http-route');
      writer.send({
        type: 'codex-response',
        sessionId: 'codex-thread-http-route',
        data: {
          type: 'item',
          itemType: 'agent_message',
          itemId: 'http-msg',
          message: {
            role: 'assistant',
            content: 'HTTP route completed answer',
          },
        },
      });
      writer.send({
        type: 'codex-complete',
        sessionId: 'codex-thread-http-route',
        actualSessionId: 'codex-thread-http-route',
      });
    },
  });
  const { server, baseUrl } = await startAgentRouteApp(injectedRouter);

  try {
    const response = await fetch(`${baseUrl}/api/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
      },
      body: JSON.stringify({
        projectPath: projectDir,
        message: 'route workspace validation regression',
        stream: false,
      }),
    });
    const body = await response.json();
    const resolvedProjectDir = await fs.realpath(projectDir);

    assert.equal(response.status, 200);
    assert.deepEqual(observed.order, ['resolve', 'run']);
    assert.equal(observed.resolverInput, projectDir);
    assert.equal(observed.runnerProjectPath, resolvedProjectDir);
    assert.equal(body.success, true);
    assert.equal(body.sessionId, 'codex-thread-http-route');
    assert.equal(body.projectPath, resolvedProjectDir);
    assert.deepEqual(body.messages, [
      {
        role: 'assistant',
        content: 'HTTP route completed answer',
      },
    ]);
  } finally {
    await closeServer(server);
  }
});

test('cleanupProject removes clones under .ozw external-projects', async () => {
  const projectDir = path.join(tempHome, '.ozw', 'external-projects', 'repo-hash');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'README.md'), 'temporary clone', 'utf8');

  assert.equal(isCbwExternalProjectPath(projectDir), true);

  await cleanupProject(projectDir);

  assert.equal(await pathExists(projectDir), false);
});

test('cleanupProject refuses external-projects root and unrelated paths', async () => {
  const externalProjectsRoot = path.join(tempHome, '.ozw', 'external-projects');
  const unrelatedProject = path.join(tempHome, 'workspace', 'repo');

  await fs.mkdir(externalProjectsRoot, { recursive: true });
  await fs.mkdir(unrelatedProject, { recursive: true });

  assert.equal(isCbwExternalProjectPath(externalProjectsRoot), false);
  assert.equal(isCbwExternalProjectPath(unrelatedProject), false);

  await cleanupProject(externalProjectsRoot);
  await cleanupProject(unrelatedProject);

  assert.equal(await pathExists(externalProjectsRoot), true);
  assert.equal(await pathExists(unrelatedProject), true);
});
