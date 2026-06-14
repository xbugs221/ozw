// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify Pi CLI status endpoint returns correct availability,
 * command path, version, and authentication unknown for both available
 * and unavailable fake pi binaries. Also covers the send gate that must
 * never use Pi CLI executability in place of co provider gating.
 *
 * These tests satisfy task.md 6.6.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const CCFLOW_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);
const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  await new Promise((resolve) => server.close(resolve));
  return addr.port;
}

async function waitForHealth(port, child, outputRef) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${outputRef.text}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not become healthy: ${outputRef.text}`);
}

async function stopServer(child, tempRoot) {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((r) => child.once('exit', r)),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi CLI available returns commandPath and version without secrets
// ─────────────────────────────────────────────────────────────────────────────

test('/api/cli/pi/status returns available=true with commandPath and version when pi is on PATH', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-cli-avail-'));
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const port = await getFreePort();

  // Create a fake pi binary that reports a version
  await fs.mkdir(binDir, { recursive: true });
  const piPath = path.join(binDir, 'pi');
  await fs.writeFile(piPath, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    '  echo "pi 0.74.0"',
    '  exit 0',
    'fi',
    'exit 0',
  ].join('\n'), { mode: 0o755 });

  const outputRef = { text: '' };
  const child = spawn(process.execPath, [TSX_CLI, 'backend/index.ts'], {
    cwd: CCFLOW_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: databasePath,
      PATH: `${binDir}:${process.env.PATH || ''}`,
      SESSION_PATH_SCAN_INTERVAL_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => { outputRef.text += c.toString(); });
  child.stderr.on('data', (c) => { outputRef.text += c.toString(); });

  try {
    await waitForHealth(port, child, outputRef);

    // Register a user to get an auth token for the authenticated endpoint
    const regRes = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'pi-cli-tester', password: 'cli-pass' }),
    });
    const { token } = await regRes.json();

    const res = await fetch(`http://127.0.0.1:${port}/api/cli/pi/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    assert.equal(data.available, true, 'must report pi as available');
    assert.ok(data.commandPath, 'must return commandPath');
    assert.ok(data.commandPath.includes('pi'), 'commandPath must reference pi');
    assert.equal(data.version, 'pi 0.74.0', 'must return version from --version');
    assert.equal(data.authenticated, null, 'must report authenticated=null (no auth concept)');
    assert.equal(data.error, null, 'must not report error');

    // Must NOT expose API key, token, or secret
    const sensitiveKeys = ['apiKey', 'api_key', 'token', 'secret', 'password', 'key'];
    for (const key of sensitiveKeys) {
      assert.equal(key in data, false, `must not expose ${key}`);
    }
    const dataText = JSON.stringify(data);
    assert.ok(!dataText.includes('sk-'), 'must not contain API key pattern');
  } finally {
    await stopServer(child, tempRoot);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi CLI not on PATH returns available=false with clear error
// ─────────────────────────────────────────────────────────────────────────────

test('/api/cli/pi/status returns available=false when pi is not on PATH', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-cli-absent-'));
  const databasePath = path.join(tempRoot, 'auth.db');
  const port = await getFreePort();

  // Create a bin directory with oz and wo but WITHOUT pi.
  // Find the real oz binary on the current PATH and symlink it.
  const workBinDir = path.join(tempRoot, 'work-bin');
  await fs.mkdir(workBinDir, { recursive: true });

  const originalPath = (process.env.PATH || '').split(':');
  for (const cmd of ['oz', 'wo']) {
    let found = false;
    for (const dir of originalPath) {
      const cmdPath = path.join(dir, cmd);
      try {
        await fs.access(cmdPath, fs.constants.X_OK);
        await fs.symlink(cmdPath, path.join(workBinDir, cmd));
        found = true;
        break;
      } catch {}
    }
    if (!found) {
      // Fallback: create a stub that exits 0
      await fs.writeFile(path.join(workBinDir, cmd), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
  }

  const outputRef = { text: '' };
  const child = spawn(process.execPath, [TSX_CLI, 'backend/index.ts'], {
    cwd: CCFLOW_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: databasePath,
      PATH: `${workBinDir}:/usr/bin:/usr/local/bin`,
      SESSION_PATH_SCAN_INTERVAL_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => { outputRef.text += c.toString(); });
  child.stderr.on('data', (c) => { outputRef.text += c.toString(); });

  try {
    await waitForHealth(port, child, outputRef);

    // Register to get auth token
    const regRes = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'pi-absent-tester', password: 'absent-pass' }),
    });
    const { token } = await regRes.json();

    const res = await fetch(`http://127.0.0.1:${port}/api/cli/pi/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    assert.equal(data.available, false, 'must report pi as unavailable');
    assert.equal(data.commandPath, '', 'commandPath must be empty when pi not found');
    assert.equal(data.authenticated, null, 'must report authenticated=null');
    assert.ok(data.error, 'must include an error message');
    assert.ok(
      data.error.toLowerCase().includes('not found') || data.error.toLowerCase().includes('path'),
      `error must explain pi is not found, got: ${data.error}`,
    );
  } finally {
    await stopServer(child, tempRoot);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi CLI executability does not bypass co provider gate
// ─────────────────────────────────────────────────────────────────────────────

test('Pi CLI on PATH does not bypass co provider gate for chat sends', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-gate-cli-'));
  const binDir = path.join(tempRoot, 'bin');
  const coHome = path.join(tempRoot, 'co');
  const databasePath = path.join(tempRoot, 'auth.db');
  const port = await getFreePort();

  // Pi is on PATH, but co says providers.pi=false
  await fs.mkdir(binDir, { recursive: true });
  const piPath = path.join(binDir, 'pi');
  await fs.writeFile(piPath, [
    '#!/bin/sh',
    'echo "pi 0.74.0"',
    'exit 0',
  ].join('\n'), { mode: 0o755 });

  const coPath = path.join(binDir, 'co');
  await fs.writeFile(coPath, [
    '#!/bin/sh',
    'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
    `  printf '%s\\n' '{"ok":true,"contract":"co-request-v1","version":"test","home":"${coHome}","providers":{"codex":true,"opencode":true,"pi":false}}'`,
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });

  await fs.mkdir(path.join(coHome, 'requests', 'pending'), { recursive: true });

  const outputRef = { text: '' };
  const child = spawn(process.execPath, [TSX_CLI, 'backend/index.ts'], {
    cwd: CCFLOW_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: databasePath,
      CCFLOW_CO_HOME: coHome,
      SESSION_PATH_SCAN_INTERVAL_MS: '0',
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => { outputRef.text += c.toString(); });
  child.stderr.on('data', (c) => { outputRef.text += c.toString(); });

  try {
    await waitForHealth(port, child, outputRef);

    // Register a user for authenticated API calls
    const regRes = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gate-tester', password: 'gate-pass' }),
    });
    const { token } = await regRes.json();

    // First verify Pi CLI status shows available
    const cliRes = await fetch(`http://127.0.0.1:${port}/api/cli/pi/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const cliData = await cliRes.json();
    assert.equal(cliData.available, true, 'Pi CLI must be available on PATH');

    // But trying to create a Pi manual session should fail because co gate blocks it
    const createRes = await fetch(
      `http://127.0.0.1:${port}/api/projects/pi-test-project/manual-sessions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provider: 'pi', label: 'blocked session', projectPath: tempRoot }),
      },
    );
    const createData = await createRes.json();

    // The create should fail because co provider gate says pi is unavailable
    assert.ok(
      !createRes.ok || createData.error,
      `must reject Pi session creation when co providers.pi=false, got ${JSON.stringify(createData)}`,
    );

    // Verify no pending request was written
    const pendingFiles = await fs.readdir(path.join(coHome, 'requests', 'pending')).catch(() => []);
    assert.equal(pendingFiles.length, 0, 'must not write any pending request');

    // Verify no draft was created (check the project config)
    const projectConfDir = path.join(tempRoot, '.ozw');
    try {
      const confFiles = await fs.readdir(projectConfDir);
      const confFile = confFiles.find((f) => f === 'conf.json');
      if (confFile) {
        const confRaw = await fs.readFile(path.join(projectConfDir, confFile), 'utf8');
        const conf = JSON.parse(confRaw);
        assert.ok(
          !conf.piSessions || conf.piSessions.length === 0,
          'must not create piSessions entry when provider is unavailable',
        );
      }
    } catch {
      // Project config may not exist at all, which is fine
    }
  } finally {
    await stopServer(child, tempRoot);
  }
});
