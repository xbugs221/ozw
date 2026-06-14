// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Pin non-streaming agent route internals that adapt Codex writer
 * events and clean up temporary cloned repositories.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const originalHome = process.env.HOME;
const originalDatabasePath = process.env.DATABASE_PATH;
const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-agent-route-test-'));

process.env.HOME = tempHome;
process.env.DATABASE_PATH = path.join(tempHome, 'auth.db');

const {
  __agentRouteInternalsForTest: {
    ResponseCollector,
    cleanupProject,
    isCbwExternalProjectPath,
  },
} = await import('../../backend/routes/agent.ts');

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
