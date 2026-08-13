/**
 * 文件目的：验证 ozw CLI 在产生运行时副作用前拒绝无效命令行参数。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const CLI_PATH = path.resolve('backend/cli.ts');

/**
 * 在独立进程中执行源码 CLI，以验证真实退出码和用户错误信息。
 */
function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 5_000,
  });
}

test('CLI rejects unknown options before startup', () => {
  /** Business case: typos must not silently start a server. */
  const result = runCli(['--porrt', '4000']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option: --porrt/);
});

test('CLI rejects missing and invalid port values before startup', () => {
  /** Business case: invalid network configuration should be actionable. */
  const missing = runCli(['--port']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--port requires a value/);

  const invalid = runCli(['--port', '70000']);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /port must be an integer between 1 and 65535/i);
});

test('CLI rejects missing database path values before startup', () => {
  /** Business case: a missing path must not fall back to an unintended database. */
  const result = runCli(['--database-path']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--database-path requires a value/);
});

test('CLI preserves equals signs in database paths and terminal flags take precedence', () => {
  /** Business case: legitimate paths and harmless help/version probes must never start the server. */
  const help = runCli(['--help', 'start']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);
  assert.doesNotMatch(help.stdout, /\u001b\[/u);

  const version = runCli(['start', '--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/u);

  const status = runCli(['status', '--database-path=/tmp/ozw=a.db']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /ozw=a\.db/u);
});
