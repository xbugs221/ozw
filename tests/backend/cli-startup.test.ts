/**
 * 文件目的：锁定 CLI 启动不访问网络，并验证显式更新命令只提供发布指引。
 * 业务场景：用户启动已编译应用时，不应因包注册表不可用而等待或看到错误噪声。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CLI_SOURCE_PATH = 'backend/cli.ts';

test('start path has no package-registry or child-process update check', () => {
  /**
   * 直接锁定整个 CLI 不依赖外部进程，避免更新查询以后以其他名称重新混入启动热路径。
   */
  const source = readFileSync(CLI_SOURCE_PATH, 'utf8');
  assert.doesNotMatch(source, /child_process|npm\s+(?:show|view|update|install)/);

  const startBody = source.match(/async function startServer\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(startBody, /import\(['"]\.\/index\.js['"]\)/);
  assert.doesNotMatch(startBody, /checkForUpdates|execSync|spawnSync|npm\s/i);
});

test('explicit update command returns local release guidance without npm access', () => {
  /**
   * 更新命令保留可发现性，但只读取本地版本并指向独立发布页。
   */
  const output = execFileSync(process.execPath, ['--import', 'tsx', CLI_SOURCE_PATH, 'update'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5000,
  });

  assert.match(output, /Automatic CLI updates are not supported/);
  assert.match(output, /Current version:.*\d+\.\d+\.\d+/s);
  assert.match(output, /github\.com\/xbugs221\/ozw\/releases\/latest/);
  assert.doesNotMatch(output, /E404|npm error|Checking for updates/);
});
