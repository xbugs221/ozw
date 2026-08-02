// @ts-nocheck -- Shared helper for strictness-deferred backend integration tests.
/**
 * PURPOSE: Start a real isolated backend server for integration tests while
 * centralizing auth, database isolation, WebSocket authentication, and cleanup.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import WebSocket from 'ws';

const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';
const DEFAULT_TEST_ACCESS_TOKEN = '0123456789abcdef0123456789abcdef';

async function getFreePort() {
  /** Allocate a loopback port for the short-lived backend fixture process. */
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForHealth(fixture, timeoutMs = 15_000) {
  /** Wait until the real backend accepts HTTP requests or exits early. */
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fixture.child.exitCode !== null) {
      throw new Error(`server exited early: ${fixture.output.text}`);
    }
    try {
      const response = await fetch(`${fixture.baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${fixture.output.text}`);
}

export async function startIsolatedBackendServer(options = {}) {
  /**
   * Start backend/index.ts with a per-test database so auth and application
   * state cannot leak between test processes.
   */
  const port = options.port || await getFreePort();
  const cwd = options.cwd || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
  const output = { text: '' };
  const env = {
    ...process.env,
    ...options.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_PATH: options.databasePath,
    OZW_DATABASE_PATH_DEFAULTED: '',
    OZW_FAKE_PI_RUNTIME: '1',
    SESSION_PATH_SCAN_INTERVAL_MS: '0',
    OZW_ACCESS_TOKEN: options.accessToken || DEFAULT_TEST_ACCESS_TOKEN,
  };
  if (!env.DATABASE_PATH) {
    throw new Error('startIsolatedBackendServer requires databasePath');
  }

  const child = spawn(process.execPath, [TSX_CLI, 'backend/index.ts'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output.text += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output.text += chunk.toString(); });

  const fixture = {
    child,
    output,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    accessToken: env.OZW_ACCESS_TOKEN,
  };
  await waitForHealth(fixture, options.healthTimeoutMs);
  return fixture;
}

export async function authenticateTestClient(fixture) {
  /** Exchange the fixture access token for a real internal JWT session. */
  const response = await fetch(`${fixture.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: fixture.accessToken }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`test client login failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

export async function openAuthenticatedWebSocket(fixture, token) {
  /** Open the real backend WebSocket using the Authorization header contract. */
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(fixture.wsUrl, {
      headers: { Host: `127.0.0.1:${fixture.port}`, authorization: `Bearer ${token}` },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

export async function stopBackendServerFixture(fixture) {
  /** Stop the backend fixture process without relying on process exit hooks. */
  if (!fixture?.child || fixture.child.exitCode !== null || fixture.child.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    /** Clear the fallback timer when SIGTERM succeeds so tests do not retain a three-second event-loop handle. */
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      fixture.child.off('exit', finish);
      resolve();
    };
    const forceKillTimer = setTimeout(() => {
      if (fixture.child.exitCode === null) fixture.child.kill('SIGKILL');
      finish();
    }, 3000);
    fixture.child.once('exit', finish);
    if (fixture.child.exitCode !== null || fixture.child.signalCode !== null) {
      finish();
      return;
    }
    fixture.child.kill('SIGTERM');
  });
}
