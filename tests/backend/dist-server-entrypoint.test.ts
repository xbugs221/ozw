/**
 * PURPOSE: Verify the compiled backend entrypoint contains every runtime file
 * needed for the packaged `ozw` service to start.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeFakeWorkflowTools } from './helpers/workflow-tools.ts';

const REPO_ROOT = process.cwd();
const DIST_RUNTIME_COMPAT_PATH = path.join(
  REPO_ROOT,
  'dist-node/backend/domains/projects/project-domain-runtime-compat.js',
);

type ManagedChildProcess = ReturnType<typeof spawn>;

/**
 * Reserve an available localhost TCP port for the short-lived service process.
 */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Could not allocate a TCP port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

/**
 * Wait until the compiled server prints the ready banner or exits.
 */
async function waitForCompiledServerReady(
  child: ManagedChildProcess,
  output: () => string,
): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 15_000;

  while (Date.now() - startedAt < timeoutMs) {
    if (output().includes('ozw Server - Ready')) {
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(`Compiled server exited early with ${child.exitCode}\n${output()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for compiled server startup\n${output()}`);
}

/**
 * Stop the service process without leaving a listener behind for later tests.
 */
async function stopChild(child: ManagedChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

test('compiled backend entrypoint starts after build', async () => {
  fs.rmSync(DIST_RUNTIME_COMPAT_PATH, { force: true });

  const build = execFileSync('pnpm', ['run', 'build:server'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(build, /tsc -p tsconfig\.build\.json/);
  assert.equal(fs.existsSync(DIST_RUNTIME_COMPAT_PATH), false);

  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'ozw-dist-start-'));
  const binDir = path.join(tempHome, 'bin');
  await writeFakeWorkflowTools(binDir);

  const port = await getFreePort();
  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, ['dist-node/backend/index.js'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      PORT: String(port),
      DATABASE_PATH: path.join(tempHome, '.ozw', 'auth.db'),
      CCFLOW_FAKE_RUNNER: '1',
      CCFLOW_FAKE_RUNNER_DELAY_MS: '50',
      CCFLOW_FAKE_CO_DELAY_MS: '50',
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      XDG_STATE_HOME: path.join(tempHome, '.local', 'state'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForCompiledServerReady(child, () => `${stdout}\n${stderr}`);
  } finally {
    await stopChild(child);
    await rm(tempHome, { recursive: true, force: true });
  }
});
