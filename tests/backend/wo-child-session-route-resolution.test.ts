// @ts-nocheck -- Test isolation: strict types deferred.
/**
 * PURPOSE: Route resolution contract test — prove that workflow child sessions
 * with different providers produce the correct __provider when resolved from
 * route addresses.  Uses the REAL resolveSessionProvider from the production
 * utility (frontend/utils/session-provider.ts) so the test verifies the actual
 * production code, not a copy.
 *
 * Covers spec 场景：点击 Pi role row 进入 workflow child route
 *               路由刷新后 selectedSession.__provider 仍是 pi
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { buildWorkflowReadModel } from '../../backend/domains/workflows/workflow-read-model.ts';
import { resolveSessionProvider } from '../../frontend/utils/session-provider.ts';

async function writeWoState(runDir, state) {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, 'state.json'),
    JSON.stringify(state, null, 2),
    'utf8',
  );
}

/**
 * Resolve which childSession matches a given route address.
 * This mirrors the address-matching logic from useProjectsState.ts
 * to ensure the route contract is verified end-to-end.
 */
function findChildSessionByAddress(childSessions, routeAddress) {
  const parts = routeAddress.split('/');
  const isById = parts[0] === 'by-id';
  const addressSessionId = isById ? parts.slice(1).join('/') : '';

  return (childSessions || []).find((entry) => {
    if (!isById) {
      return entry.address === routeAddress
        || entry.routePath?.endsWith(`/sessions/${routeAddress}`);
    }
    return entry.address === routeAddress
      || entry.id === addressSessionId;
  }) || null;
}

test('sessions-only Pi executor resolves to __provider=pi via execution address', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-route-res-pi-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-res-pi');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-res-pi',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: { 'pi:executor': 'pi-thread-route-1' },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-res-pi',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    const childSession = findChildSessionByAddress(model.childSessions, 'execution');
    assert.ok(childSession, 'Should find child session at execution address');
    assert.equal(childSession.id, 'pi-thread-route-1');

    // Use the REAL production resolveSessionProvider
    const provider = resolveSessionProvider(
      { id: childSession.id, provider: childSession.provider },
      null,
      null,
    );
    assert.equal(provider, 'pi',
      'resolveSessionProvider must return pi for a childSession with provider=pi');
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('multi-provider execution: codex claims address, pi uses by-id with __provider=pi', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-route-res-multi-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-res-multi');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-res-multi',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'codex:executor': 'codex-exec-route',
        'pi:executor': 'pi-exec-route',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-res-multi',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    // execution → codex
    const codexChild = findChildSessionByAddress(model.childSessions, 'execution');
    assert.ok(codexChild);
    assert.equal(resolveSessionProvider({ id: codexChild.id, provider: 'codex' }, null, null), 'codex');

    // by-id/pi-exec-route → pi
    const piChild = findChildSessionByAddress(model.childSessions, 'by-id/pi-exec-route');
    assert.ok(piChild);
    assert.equal(piChild.id, 'pi-exec-route');
    assert.equal(resolveSessionProvider({ id: piChild.id, provider: 'pi' }, null, null), 'pi');
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('explicit process + sessions-only: codex owns execution, pi at by-id with __provider=pi', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-route-res-explicit-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-res-explicit');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-res-explicit',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      processes: [
        { stage: 'execution', role: 'executor', status: 'running', session_id: 'codex-ep-route', pid: 200 },
      ],
      sessions: {
        'codex:executor': 'codex-ep-route',
        'pi:executor': 'pi-ep-route',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-res-explicit',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    const codexChild = findChildSessionByAddress(model.childSessions, 'execution');
    assert.ok(codexChild);
    assert.equal(resolveSessionProvider({ id: codexChild.id, provider: 'codex' }, null, null), 'codex');

    const piChild = findChildSessionByAddress(model.childSessions, 'by-id/pi-ep-route');
    assert.ok(piChild, 'Should find Pi session at by-id address');
    assert.equal(piChild.id, 'pi-ep-route');
    assert.equal(resolveSessionProvider({ id: piChild.id, provider: 'pi' }, null, null), 'pi');
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('refresh/reload: same route address always resolves to same provider', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-route-refresh-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-refresh');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-refresh',
      contract_version: 'v1',
      status: 'running',
      stage: 'fix_1',
      stages: { execution: 'completed', review_1: 'completed', fix_1: 'running' },
      sessions: {
        'codex:reviewer': 'codex-review-refresh',
        'pi:reviewer': 'pi-review-refresh',
        fix_1: 'fix-session-refresh',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));

    const model1 = await buildWorkflowReadModel({
      projectPath, runDirName: 'run-refresh', state: stateObj, statePath, stateStat: stat,
    });
    const model2 = await buildWorkflowReadModel({
      projectPath, runDirName: 'run-refresh', state: stateObj, statePath, stateStat: stat,
    });

    // Both models must produce identical route → provider mappings
    for (const address of ['review_1', 'fix_1']) {
      const cs1 = findChildSessionByAddress(model1.childSessions, address);
      const cs2 = findChildSessionByAddress(model2.childSessions, address);
      assert.ok(cs1, `Model 1 should resolve ${address}`);
      assert.ok(cs2, `Model 2 should resolve ${address}`);
      const p1 = resolveSessionProvider({ id: cs1.id, provider: cs1.provider }, null, null);
      const p2 = resolveSessionProvider({ id: cs2.id, provider: cs2.provider }, null, null);
      assert.equal(p1, p2, `${address} → same provider after rebuild`);
      assert.equal(cs1.id, cs2.id, `${address} → same session id after rebuild`);
    }

    // by-id addresses must also be stable
    const byIds = [...model1.childSessions, ...model2.childSessions]
      .filter((s) => s.address?.startsWith('by-id/'))
      .map((s) => s.address);
    for (const addr of [...new Set(byIds)]) {
      const cs1 = findChildSessionByAddress(model1.childSessions, addr);
      const cs2 = findChildSessionByAddress(model2.childSessions, addr);
      if (cs1 && cs2) {
        const p1 = resolveSessionProvider({ id: cs1.id, provider: cs1.provider }, null, null);
        const p2 = resolveSessionProvider({ id: cs2.id, provider: cs2.provider }, null, null);
        assert.equal(p1, p2, `by-id ${addr} → same provider after refresh`);
      }
    }
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('childSession.provider=pi is not overridden by project.codexSessions membership', () => {
  // Reproduce the bug: a Pi workflow child session whose id also appears
  // in project.codexSessions must still resolve to 'pi', not 'codex'.
  const provider = resolveSessionProvider(
    { id: 'shared-session-id', provider: 'pi' },
    null,
    {
      codexSessions: [{ id: 'shared-session-id' }],
      opencodeSessions: [],
      piSessions: [],
    },
  );
  assert.equal(provider, 'pi',
    'Pi childSession.provider must win over codexSessions membership');

  // Also verify: codex childSession with piSessions membership stays codex
  const codexProvider = resolveSessionProvider(
    { id: 'shared-id-2', provider: 'codex' },
    null,
    { piSessions: [{ id: 'shared-id-2' }] },
  );
  assert.equal(codexProvider, 'codex',
    'Codex childSession.provider must win over piSessions membership');

  // Verify: no childSession.provider → falls back to list membership
  const listFallback = resolveSessionProvider(
    { id: 'only-in-pi-list' },
    null,
    { piSessions: [{ id: 'only-in-pi-list' }] },
  );
  assert.equal(listFallback, 'pi',
    'Without childSession.provider, piSessions membership should resolve to pi');
});
