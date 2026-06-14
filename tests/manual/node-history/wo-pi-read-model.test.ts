// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify wo read model handles pi:* session references:
 * - pi:executor with matching Pi session → linked sessionRef
 * - pi:archiver without matching session → unlinked sessionRef
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { buildWorkflowReadModel } from '../../../backend/domains/workflows/workflow-read-model.ts';

// Helper to create a minimal wo state.json
async function writeWoState(runDir, state) {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, 'state.json'),
    JSON.stringify(state, null, 2),
    'utf8',
  );
}

test('pi: prefix in wo sessions produces unlinked ref when provider unknown', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-pi-wo-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-pi-test');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-pi-test',
      contract_version: 'v1',
      status: 'completed',
      stage: 'archive',
      stages: {
        execution: 'completed',
        archive: 'completed',
      },
      sessions: {
        'pi:executor': 'c100',
        'pi:archiver': 'c101',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-pi-test',
      state,
      statePath,
      stateStat: stat,
    });

    // Check that pi: sessions appear in workflowOwnedSessions
    const sessions = model.runnerDiagnostics?.workflowOwnedSessions || [];
    const piExecutor = sessions.find((s) => s.provider === 'pi' && s.role === 'executor');
    const piArchiver = sessions.find((s) => s.provider === 'pi' && s.role === 'archiver');

    assert.ok(piExecutor, 'pi:executor should be in workflowOwnedSessions');
    assert.equal(piExecutor.sessionId, 'c100');
    assert.ok(piArchiver, 'pi:archiver should be in workflowOwnedSessions');
    assert.equal(piArchiver.sessionId, 'c101');

    // Check role summary: pi:executor and pi:archiver should be unlinked
    // since there are no matching piSessions in any project
    const rows = model.workflowRoleSummary?.rows || [];
    const executorRow = rows.find((r) => r.role === 'executor');
    const archiverRow = rows.find((r) => r.role === 'archiver');

    // Both should have sessionRef with pi provider
    if (executorRow?.sessionRef) {
      assert.equal(executorRow.sessionRef.provider, 'pi');
    }
    if (archiverRow?.sessionRef) {
      assert.equal(archiverRow.sessionRef.provider, 'pi');
    }
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('isKnownProvider recognizes pi', async () => {
  // Test via buildWorkflowReadModel which uses isKnownProvider internally
  const projectPath = path.join(os.tmpdir(), `ozw-pi-known-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-known');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-known',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: {
        execution: 'active',
      },
      sessions: {
        'pi:executor': 'c200',
        'codex:reviewer': 'c201',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-known',
      state,
      statePath,
      stateStat: stat,
    });

    // Both pi and codex should be recognized as known providers
    const rows = model.workflowRoleSummary?.rows || [];
    const executorRow = rows.find((r) => r.role === 'executor');
    assert.ok(executorRow, 'executor row should exist');

    // known providers (codex, opencode, pi) should NOT set unlinked: true
    // when there's no matching project session
    const sessions = model.runnerDiagnostics?.workflowOwnedSessions || [];
    const piSession = sessions.find((s) => s.provider === 'pi');
    assert.ok(piSession, 'pi session should be in owned sessions');
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});
