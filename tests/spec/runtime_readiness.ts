/**
 * PURPOSE: 验证 ozw 统一运行依赖自检 read model，
 * 确保用户能看到 oz、Codex、Pi 的安装状态和登录修复动作。
 *
 * Sources: 1-统一运行依赖自检
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildRuntimeReadinessReport } from '../../backend/runtime-readiness.ts';

async function writeExecutable(filePath: string, lines: string[]): Promise<void> {
  /**
   * PURPOSE: 写入真实可执行脚本，让规格测试走 PATH 和 child_process 解析路径。
   */
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, { mode: 0o755 });
}

test('统一运行依赖报告覆盖 oz、Codex、Pi 和登录动作', async () => {
  /**
   * 业务场景：新用户启动前想知道服务进程能否找到三个必要 CLI。
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-readiness-'));
  const binDir = path.join(tempRoot, 'bin');

  try {
    await writeExecutable(path.join(binDir, 'oz'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "oz 1.2.3"; exit 0; fi',
      'if [ "$1" = "flow" ] && [ "$2" = "contract" ] && [ "$3" = "--json" ]; then',
      '  printf "%s\\n" \'{"json":true,"version":"test","capabilities":["list-changes","run","resume","status","abort"]}\'',
      '  exit 0',
      'fi',
      'exit 1',
    ]);
    await writeExecutable(path.join(binDir, 'codex'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "codex 0.134.0"; exit 0; fi',
      'exit 0',
    ]);
    await writeExecutable(path.join(binDir, 'pi'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "pi 0.75.5"; exit 0; fi',
      'exit 0',
    ]);

    const report = await buildRuntimeReadinessReport({
      env: {
        ...process.env,
        PATH: binDir,
      },
    });

    assert.equal(report.ready, true);
    assert.deepEqual(Object.keys(report.commands).sort(), ['codex', 'oz', 'pi']);
    assert.equal(report.commands.oz.version, 'oz 1.2.3');
    assert.equal(report.commands.codex.version, 'codex 0.134.0');
    assert.equal(report.commands.pi.version, 'pi 0.75.5');
    assert.equal(report.commands.codex.authenticated, 'unknown');
    assert.equal(report.commands.pi.authenticated, 'unknown');
    assert.match(report.commands.codex.requiredAction, /codex login/);
    assert.match(report.commands.pi.requiredAction, /pi login/);

    await fs.mkdir(path.join(process.cwd(), 'test-results/runtime-readiness'), { recursive: true });
    await fs.writeFile(
      path.join(process.cwd(), 'test-results/runtime-readiness/report.json'),
      JSON.stringify(report, null, 2),
      'utf8',
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('oz flow contract 缺少能力时整体 ready=false 并说明缺失能力', async () => {
  /**
   * 业务场景：oz 可执行但 workflow 子命令不兼容时，页面不能误报可运行。
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-readiness-bad-oz-'));
  const binDir = path.join(tempRoot, 'bin');

  try {
    await writeExecutable(path.join(binDir, 'oz'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "oz 1.2.3"; exit 0; fi',
      'if [ "$1" = "flow" ] && [ "$2" = "contract" ] && [ "$3" = "--json" ]; then',
      '  printf "%s\\n" \'{"json":true,"version":"test","capabilities":["list-changes"]}\'',
      '  exit 0',
      'fi',
      'exit 1',
    ]);
    await writeExecutable(path.join(binDir, 'codex'), ['#!/bin/sh', 'echo "codex 0.134.0"']);
    await writeExecutable(path.join(binDir, 'pi'), ['#!/bin/sh', 'echo "pi 0.75.5"']);

    const report = await buildRuntimeReadinessReport({
      env: {
        ...process.env,
        PATH: binDir,
      },
    });

    assert.equal(report.ready, false);
    assert.equal(report.commands.oz.available, true);
    assert.match(report.commands.oz.error, /run|resume|status|abort/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
