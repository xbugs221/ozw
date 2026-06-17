/**
 * 文件目的：锁定后端命令解析 helper 的低状态安全行为，防止命令 allowlist、路径和输出清理边界退化。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPathSafe,
  sanitizeOutput,
  validateCommand,
} from '../../backend/utils/commandParser.ts';

test('command parser allows only explicit safe commands and rejects shell operators', () => {
  /**
   * 命令入口必须只接受 allowlist 内的基础命令，并拒绝 shell 组合执行。
   */
  assert.deepEqual(validateCommand('echo "hello world"'), {
    allowed: true,
    command: 'echo',
    args: ['hello world'],
  });
  assert.equal(validateCommand('/usr/bin/git status').allowed, true);

  const operator = validateCommand('echo ok && rm -rf /tmp/demo');
  assert.equal(operator.allowed, false);
  assert.match(operator.error || '', /Shell operators/);

  const denied = validateCommand('ssh prod');
  assert.equal(denied.allowed, false);
  assert.match(denied.error || '', /not in the allowlist/);
});

test('command parser rejects dangerous arguments and keeps path/output helpers bounded', () => {
  /**
   * 参数、文件 include 和输出展示都必须拒绝越界或不可见控制字符。
   */
  const dangerous = validateCommand('echo bad{arg}');
  assert.equal(dangerous.allowed, false);
  assert.match(dangerous.error || '', /dangerous characters/);

  assert.equal(isPathSafe('src/index.ts', '/work/demo'), true);
  assert.equal(isPathSafe('../secret.txt', '/work/demo'), false);
  assert.equal(isPathSafe('/etc/passwd', '/work/demo'), false);
  assert.equal(isPathSafe('.', '/work/demo'), false);

  assert.equal(sanitizeOutput('ok\u0000\nnext\tline\u001b[31m'), 'ok\nnext\tline[31m');
});
