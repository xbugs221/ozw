// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify provider transcript watcher events carry the IDs needed for
 * event-driven chat refresh after Codex/Pi write JSONL updates.
 *
 * NOTE: The co protocol read model has been removed. ozwSessionId is now
 * derived directly from the JSONL filename or provider session id.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveProviderSessionChange } from '../../backend/provider-session-change.ts';

/**
 * Write JSONL content with a trailing newline.
 */
async function writeJsonl(filePath, records) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${records.join('\n')}\n`, 'utf8');
}

test('Codex watcher resolves long session_meta line to route session id and provider session id', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-provider-change-'));
  const projectPath = path.join(tempRoot, 'projects', 'co');
  const providerSessionId = '019e57c6-59bd-7c50-ae86-f92a5ddf624a';
  const codexRoot = path.join(tempRoot, '.codex', 'sessions');
  const codexFile = path.join(
    codexRoot,
    '2026',
    '05',
    '24',
    `rollout-2026-05-24T10-17-57-${providerSessionId}.jsonl`,
  );
  const largeInstructions = 'x'.repeat(8192);

  await fs.mkdir(projectPath, { recursive: true });
  await writeJsonl(codexFile, [
    JSON.stringify({
      timestamp: '2026-05-24T02:17:57.523Z',
      type: 'session_meta',
      payload: {
        id: providerSessionId,
        cwd: projectPath,
        base_instructions: { text: largeInstructions },
      },
    }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'hello' } }),
  ]);

  const event = await resolveProviderSessionChange({
    provider: 'codex',
    filePath: codexFile,
    rootPath: codexRoot,
    changeType: 'change',
  });

  const routeSessionId = `rollout-2026-05-24T10-17-57-${providerSessionId}`;
  assert.equal(event.sessionId, routeSessionId);
  assert.equal(event.ozwSessionId, routeSessionId);
  assert.equal(event.providerSessionId, providerSessionId);
  assert.equal(event.projectPath, projectPath);
  assert.match(event.changedFile, /rollout-2026-05-24T10-17-57/);

  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('Pi watcher resolves native session header to route session id and provider session id', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-provider-change-'));
  const projectPath = path.join(tempRoot, 'projects', 'co');
  const providerSessionId = '019e57cc-faea-73a1-b87a-dfefeb5bebed';
  const piRoot = path.join(tempRoot, '.pi', 'agent', 'sessions');
  const piFile = path.join(
    piRoot,
    '--home-zzl-projects-co--',
    `2026-05-24T02-25-11-914Z_${providerSessionId}.jsonl`,
  );

  await fs.mkdir(projectPath, { recursive: true });
  await writeJsonl(piFile, [
    JSON.stringify({
      type: 'session',
      version: 3,
      id: providerSessionId,
      timestamp: '2026-05-24T02:25:11.914Z',
      cwd: projectPath,
    }),
    JSON.stringify({
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'hello pi' }] },
    }),
  ]);

  const event = await resolveProviderSessionChange({
    provider: 'pi',
    filePath: piFile,
    rootPath: piRoot,
    changeType: 'change',
  });

  const routeSessionId = `2026-05-24T02-25-11-914Z_${providerSessionId}`;
  assert.equal(event.sessionId, routeSessionId);
  assert.equal(event.ozwSessionId, routeSessionId);
  assert.equal(event.providerSessionId, providerSessionId);
  assert.equal(event.projectPath, projectPath);
  assert.match(event.changedFile, /019e57cc-faea/);

  await fs.rm(tempRoot, { recursive: true, force: true });
});
