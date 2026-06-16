/**
 * 文件目的：运行项目清单轻量摘要浏览器规格，并把命令输出写入本提案 evidence。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

const LOG_PATH = path.join(process.cwd(), 'test-results', '18-project-domain-qa', 'project-list-runtime.log');

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

test('项目清单轻量摘要规格通过并生成 runtime evidence 日志', async () => {
  const exitCode = await runLoggedCommand(
    'pnpm',
    ['exec', 'playwright', 'test', '--config=playwright.spec.config.ts', 'tests/spec/project-list-summary-api.spec.ts'],
    LOG_PATH,
  );
  assert.equal(exitCode, 0, `project list summary 浏览器规格失败，详见 ${LOG_PATH}`);
});
