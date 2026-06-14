/**
 * Contract test: Runtime entrypoints are functional after TypeScript migration.
 *
 * PURPOSE: Verify the ozw bin, compiled CLI, and dev scripts actually execute
 * as required by spec.md § "Node 运行入口必须在迁移后可执行".
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Resolve a free TCP port for isolated server smoke tests. */
async function findFreePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to bind free port')));
      }
    });
  });
}

describe('runtime-entrypoints-after-ts-migration', () => {
  it('compiled CLI help prints usage instructions', async () => {
    const { stdout, stderr } = await execFileAsync('node', ['dist-node/backend/cli.js', 'help'], {
      cwd: process.cwd(),
      timeout: 15000,
    });
    assert.ok(
      stdout.includes('ozw - Command Line Tool') && stdout.includes('start') && stdout.includes('status'),
      `help output should contain usage: ${stdout.slice(0, 200)}`,
    );
    assert.equal(stderr, '', 'help should produce no stderr');
  });

  it('compiled bin CLI has node shebang (package bin is Node-runnable)', () => {
    const cliContent = readFileSync('dist-node/backend/cli.js', 'utf8');
    assert.ok(
      cliContent.startsWith('#!/usr/bin/env node'),
      'dist-node/backend/cli.js should start with node shebang',
    );
  });

  it('compiled CLI version outputs a non-empty semver', async () => {
    const { stdout, stderr } = await execFileAsync('node', ['dist-node/backend/cli.js', 'version'], {
      cwd: process.cwd(),
      timeout: 15000,
    });
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/, `version should be semver, got: ${stdout.trim()}`);
    assert.equal(stderr, '', 'version should produce no stderr');
  });

  it('compiled CLI status reports installation directory', async () => {
    const { stdout, stderr } = await execFileAsync('node', ['dist-node/backend/cli.js', 'status'], {
      cwd: process.cwd(),
      timeout: 15000,
    });
    assert.ok(
      stdout.includes('Installation Directory'),
      `status should report installation dir: ${stdout.slice(0, 300)}`,
    );
    assert.equal(stderr, '', 'status should produce no stderr');
  });

  it('compiled CLI start on a free port boots to Ready and responds to SIGTERM', async () => {
    const port = await findFreePort();
    const dbPath = `/tmp/ozw-test-smoke-${port}.db`;

    const child = spawn('node', ['dist-node/backend/cli.js', 'start', '--port', String(port), '--database-path', dbPath], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath },
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 20000);

    let stdout = '';
    let stderr = '';
    let readySeen = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes('ozw Server - Ready')) {
        readySeen = true;
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const exitCode: number = await new Promise((resolve) => {
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
    });

    // SIGTERM exit code (143 = 128 + 15) or 0 if already exiting cleanly
    if (timedOut) {
      assert.fail(`Server did not reach Ready within 20s. stdout: ${stdout.slice(0, 500)}`);
    }

    assert.ok(readySeen, `Server should print 'ozw Server - Ready'. stdout: ${stdout.slice(0, 500)}`);
    assert.ok(
      exitCode === 143 || exitCode === 0 || exitCode === null,
      `Exit code should be SIGTERM (143) or clean (0), got ${exitCode}`,
    );
  });

  it('postinstall script references tsx-runnable .ts file', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const postinstall = String(pkg.scripts?.postinstall || '');
    assert.ok(
      /tsx\s+scripts\/fix-node-pty\.ts/.test(postinstall),
      `postinstall should use tsx scripts/fix-node-pty.ts, got: ${postinstall}`,
    );
  });

  it('verify-missing-session-visibility script references tsx-runnable .ts file', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const verify = String(pkg.scripts?.['verify:missing-path-sessions'] || '');
    assert.ok(
      /tsx\s+scripts\/verify-missing-session-visibility\.ts/.test(verify),
      `verify:missing-path-sessions should use tsx, got: ${verify}`,
    );
  });

  it('dev:watch script uses tsx watch instead of raw node .js', () => {
    const sh = readFileSync('scripts/dev-watch.sh', 'utf8');
    assert.ok(
      /tsx.*server\/index\.ts/.test(sh),
      'dev-watch.sh should use tsx backend/index.ts, not node backend/index.js',
    );
    assert.ok(
      !/node\s+.*server\/index\.js/.test(sh),
      'dev-watch.sh must not reference deleted backend/index.js',
    );
  });

  it('package.json main and bin point to dist-node compiled JS, not raw TS', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    assert.ok(
      String(pkg.main || '').endsWith('.js') && String(pkg.main).startsWith('dist-node/'),
      `"main" field should point to dist-node/ .js, got: ${pkg.main}`,
    );
    assert.ok(
      !String(pkg.main || '').endsWith('.ts'),
      `"main" field must not point to raw .ts, got: ${pkg.main}`,
    );
    const ozwBin = String(pkg.bin?.ozw || '');
    assert.ok(
      ozwBin.endsWith('.js') && ozwBin.startsWith('dist-node/'),
      `"bin.ozw" should point to dist-node/ .js, got: ${ozwBin}`,
    );
    assert.ok(
      !ozwBin.endsWith('.ts'),
      `"bin.ozw" must not point to raw .ts, got: ${ozwBin}`,
    );
  });
});
