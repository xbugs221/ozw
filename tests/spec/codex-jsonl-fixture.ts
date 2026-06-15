/**
 * PURPOSE: Verify shared Codex JSONL fixture and discovery helpers produce
 * realistic files and actionable diagnostics for browser specs.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendCodexSessionEntries,
  codexAssistantMessageEntry,
  codexFunctionCallEntry,
  codexFunctionOutputEntry,
  codexSessionFilePath,
  codexUserMessageEntry,
  writeCodexSessionFixture,
} from './helpers/codex-jsonl-fixture.ts';
import { waitForCodexFixtureSession } from './helpers/fixture-session-discovery.ts';
import { PRIMARY_FIXTURE_PROJECT_PATH } from './helpers/spec-test-helpers.ts';

/**
 * Read a JSONL file into parsed row objects.
 */
async function readJsonl(filePath: string): Promise<Array<Record<string, unknown>>> {
  /**
   * PURPOSE: Keep assertions close to the provider history format the app reads.
   */
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

test('shared Codex JSONL helper writes session meta and appends provider rows', async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-codex-jsonl-fixture-'));
  const projectPath = path.join(homeDir, 'workspace', 'project');
  const sessionId = 'codex-jsonl-helper-contract';

  try {
    const result = await writeCodexSessionFixture({
      homeDir,
      projectPath,
      sessionId,
      entries: [
        codexUserMessageEntry('2026-06-09T00:00:01.000Z', 'real user prompt'),
        codexAssistantMessageEntry('2026-06-09T00:00:02.000Z', 'real assistant response'),
        codexFunctionCallEntry('2026-06-09T00:00:03.000Z', 'call-1', 'functions.exec_command', { cmd: 'pwd' }),
      ],
    });

    await appendCodexSessionEntries(sessionId, [
      codexFunctionOutputEntry('2026-06-09T00:00:04.000Z', 'call-1', '/tmp/project\n'),
    ], { homeDir });

    assert.equal(result.sessionFilePath, codexSessionFilePath(sessionId, { homeDir }));
    const rows = await readJsonl(result.sessionFilePath);
    assert.equal(rows[0].type, 'session_meta');
    assert.deepEqual((rows[0].payload as Record<string, unknown>).cwd, projectPath);
    assert.equal((rows[1].payload as Record<string, unknown>).type, 'user_message');
    assert.equal((rows[3].payload as Record<string, unknown>).type, 'function_call');
    assert.equal((rows[4].payload as Record<string, unknown>).type, 'function_call_output');
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('fixture discovery failure names project, provider id, routeIndex, and candidates', async () => {
  const request = {
    async get() {
      return {
        ok: () => true,
        async json() {
          return [{
            name: 'fixture-project',
            fullPath: PRIMARY_FIXTURE_PROJECT_PATH,
            codexSessions: [{ id: 'other-session', routeIndex: 7, title: 'Other' }],
          }];
        },
      };
    },
  };

  await assert.rejects(
    waitForCodexFixtureSession(request as never, 'missing-session', { attempts: 1, intervalMs: 1 }),
    /missing-session.*projectName=fixture-project.*routeIndex.*providerSessionId.*candidateSessions/s,
  );
});
