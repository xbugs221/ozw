// @ts-nocheck -- Proposal acceptance test: validates the Pi/cN route contract.
/**
 * PURPOSE: Verify a Pi manual session keeps its stable cN route after ozw binds
 * the underlying provider session id discovered from Pi's native session log.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  createManualSessionDraft,
  finalizeManualSessionDraft,
  getPiSessions,
  startManualSessionDraft,
} from '../../../backend/projects.ts';

async function writePiSessionHeader(homeDir, providerSessionId, projectPath) {
  /**
   * Write the first Pi JSONL record used by buildPiSessionsIndex.
   */
  const sessionFile = path.join(homeDir, '.pi', 'agent', 'sessions', '2026', `${providerSessionId}.jsonl`);
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: 'session',
        id: providerSessionId,
        cwd: projectPath,
        title: 'Pi native provider session',
        timestamp: '2026-05-23T09:38:21.745Z',
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-05-23T09:38:22.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '用 Pi 继续这个手动会话' }],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

test('Pi provider session binding keeps one stable cN route entry', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz46-pi-route-'));
  const previousHome = process.env.HOME;
  const previousXdgStateHome = process.env.XDG_STATE_HOME;
  const projectPath = path.join(tempRoot, 'project');
  const projectName = projectPath.replace(/\//g, '-');
  const providerSessionId = '019e5433-31b1-759e-806f-f95909564ab1';

  process.env.HOME = tempRoot;
  process.env.XDG_STATE_HOME = path.join(tempRoot, 'state');

  try {
    await fs.mkdir(projectPath, { recursive: true });
    await writePiSessionHeader(tempRoot, providerSessionId, projectPath);

    const draft = await createManualSessionDraft(projectName, projectPath, 'pi', '会话888');
    const startRequestId = 'chatreq-oz46-pi-route';
    const started = await startManualSessionDraft(projectName, projectPath, draft.id, 'pi', startRequestId);
    assert.equal(started.started, true);

    await finalizeManualSessionDraft(projectName, draft.id, providerSessionId, 'pi', projectPath);

    const piSessions = await getPiSessions(projectPath, { limit: 0, includeHidden: true });
    const matchingSessions = piSessions.filter((session) => (
      session.id === draft.id ||
      session.id === providerSessionId ||
      session.providerSessionId === providerSessionId
    ));

    assert.equal(matchingSessions.length, 1, 'the cN route and provider id must not appear as duplicate sessions');
    assert.equal(matchingSessions[0].id, draft.id, 'the visible route id must remain the cN draft id');
    assert.equal(
      matchingSessions[0].providerSessionId || matchingSessions[0].provider_session_id,
      providerSessionId,
      'the provider session id must be retained only as association metadata',
    );
  } finally {
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
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
