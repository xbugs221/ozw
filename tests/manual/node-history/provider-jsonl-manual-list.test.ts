// @ts-nocheck -- Proposal acceptance test for provider JSONL list semantics.
/**
 * PURPOSE: Verify ozw manual session lists are sourced from existing provider
 * JSONL files while filtering only sessions proven to be workflow-internal.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  clearProjectDirectoryCache,
  getCodexSessions,
  getPiSessions,
} from '../../../backend/projects.ts';
import { getProjectLocalConfigPath } from '../../../backend/project-config-store.ts';

async function withTemporaryHome(testBody) {
  /**
   * PURPOSE: Isolate provider discovery from the developer's real HOME.
   */
  const previousHome = process.env.HOME;
  const previousXdgStateHome = process.env.XDG_STATE_HOME;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz48-provider-jsonl-'));

  process.env.HOME = homeDir;
  process.env.XDG_STATE_HOME = path.join(homeDir, '.local', 'state');
  clearProjectDirectoryCache();

  try {
    await testBody(homeDir);
  } finally {
    clearProjectDirectoryCache();
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

async function writeJsonl(filePath, records) {
  /**
   * PURPOSE: Write real newline-delimited provider history records.
   */
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function writePiSession(homeDir, projectPath, sessionId, text) {
  /**
   * PURPOSE: Create a renderable Pi JSONL session discoverable by getPiSessions.
   */
  await writeJsonl(
    path.join(homeDir, '.pi', 'agent', 'sessions', 'oz48', `${sessionId}.jsonl`),
    [
      {
        type: 'session',
        version: 3,
        id: sessionId,
        timestamp: '2026-05-27T01:00:00.000Z',
        cwd: projectPath,
      },
      {
        type: 'message',
        timestamp: '2026-05-27T01:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text }],
        },
      },
    ],
  );
}

async function writeCodexSession(homeDir, projectPath, sessionId, text) {
  /**
   * PURPOSE: Create a Codex JSONL session discoverable by getCodexSessions.
   */
  await writeJsonl(
    path.join(homeDir, '.codex', 'sessions', '2026', '05', '27', `rollout-2026-05-27T01-00-00-${sessionId}.jsonl`),
    [
      {
        type: 'session_meta',
        timestamp: '2026-05-27T01:00:00.000Z',
        payload: {
          id: `source-${sessionId}`,
          cwd: projectPath,
          model: 'gpt-5',
        },
      },
      {
        type: 'event_msg',
        timestamp: '2026-05-27T01:00:01.000Z',
        cwd: projectPath,
        payload: {
          type: 'user_message',
          message: text,
        },
      },
    ],
  );
}

async function writeWorkflowConfig(projectPath, provider, childSessionId) {
  /**
   * PURPOSE: Persist workflow child-session metadata to the XDG state config
   * path used by ozw, not the legacy repo-local .ozw/conf.json.
   */
  const configPath = getProjectLocalConfigPath(projectPath);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 2,
      workflows: {
        1: {
          title: `${provider} workflow`,
          chat: {
            1: {
              sessionId: childSessionId,
              provider,
              stageKey: 'execution',
            },
          },
        },
      },
    }, null, 2),
    'utf8',
  );
}

test('Pi manual list keeps direct CLI JSONL and filters existing workflow child JSONL', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'pi-project');
    await fs.mkdir(projectPath, { recursive: true });

    await writePiSession(homeDir, projectPath, 'pi-workflow-child', 'workflow internal prompt');
    await writePiSession(homeDir, projectPath, 'pi-cli-direct', 'direct pi cli prompt');
    await writeWorkflowConfig(projectPath, 'pi', 'pi-workflow-child');

    const sessions = await getPiSessions(projectPath, {
      limit: 0,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const sessionIds = sessions.map((session) => session.id);

    assert.equal(sessionIds.includes('pi-workflow-child'), false);
    assert.equal(sessionIds.includes('pi-cli-direct'), true);
  });
});

test('Codex manual list keeps direct CLI JSONL and filters existing workflow child JSONL', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'codex-project');
    await fs.mkdir(projectPath, { recursive: true });

    await writeCodexSession(homeDir, projectPath, 'codex-workflow-child', 'workflow internal prompt');
    await writeCodexSession(homeDir, projectPath, 'codex-cli-direct', 'direct codex cli prompt');
    await writeWorkflowConfig(projectPath, 'codex', 'codex-workflow-child');

    const sessions = await getCodexSessions(projectPath, {
      limit: 0,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const sessionIds = sessions.map((session) => session.id);

    assert.equal(sessionIds.includes('codex-workflow-child'), false);
    assert.equal(sessionIds.includes('codex-cli-direct'), true);
  });
});
