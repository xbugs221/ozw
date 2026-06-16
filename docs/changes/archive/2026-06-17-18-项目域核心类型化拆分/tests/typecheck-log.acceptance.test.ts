/**
 * 文件目的：运行仓库 TypeScript 检查，并把命令输出写入本提案 evidence。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

const LOG_PATH = path.join(process.cwd(), 'test-results', '18-project-domain-qa', 'typecheck.log');

/**
 * 运行真实仓库命令，并把 stdout/stderr 同时写入 evidence 日志。
 */
async function runLoggedCommand(command: string, args: string[], logPath: string): Promise<number | null> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const output: string[] = [];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env });
    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));
    child.on('error', reject);
    child.on('close', async (code) => {
      await fs.writeFile(logPath, output.join(''), 'utf8');
      resolve(code);
    });
  });
}

test('TypeScript 检查通过并生成 evidence 日志', async () => {
  const exitCode = await runLoggedCommand('pnpm', ['run', 'typecheck'], LOG_PATH);
  assert.equal(exitCode, 0, `typecheck 失败，详见 ${LOG_PATH}`);
});
