/**
 * 文件目的：把 27 号提案执行时遗留的完整门禁失败转成 28 号提案的硬合同。
 * 业务风险：如果 typecheck、后端合同或 Node spec 仍失败，后续提案无法判断新回归和旧债务的边界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const RESULT_PATH = path.join(REPO_ROOT, 'test-results/historical-debt/command-results.json');
const REQUIRED_GATE_COMMANDS = [
  { id: 'typecheck', command: 'pnpm', args: ['run', 'typecheck'] },
  { id: 'test-server', command: 'pnpm', args: ['run', 'test:server'] },
  { id: 'test-spec-node', command: 'pnpm', args: ['run', 'test:spec:node'] },
] as const;
const FORBIDDEN_TEST_SHORTCUTS = /\b(?:test|describe)\.skip\s*\(|\.only\s*\(|\btodo\s*\(/;

type GateResult = {
  id: string;
  command: string;
  exitCode: number | null;
  outputTail: string;
};

test('historical debt gates pass without excluding known failures', async () => {
  /**
   * 业务场景：执行器必须让用户实际会运行的门禁转绿，而不是只跑单个修复文件。
   */
  const results: GateResult[] = [];
  for (const gate of REQUIRED_GATE_COMMANDS) {
    const result = spawnSync(gate.command, gate.args, {
      cwd: REPO_ROOT,
      env: buildStandaloneGateEnv(),
      encoding: 'utf8',
      maxBuffer: 30 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    assert.doesNotMatch(
      output,
      /node:test run\(\) is being called recursively within a test file/i,
      `${gate.id} 必须真实执行，不能接受 node:test 递归跳过输出`,
    );
    results.push({
      id: gate.id,
      command: [gate.command, ...gate.args].join(' '),
      exitCode: result.status,
      outputTail: output.slice(-8000),
    });
  }

  await mkdir(path.dirname(RESULT_PATH), { recursive: true });
  await writeFile(RESULT_PATH, `${JSON.stringify({ results }, null, 2)}\n`, 'utf8');

  const failed = results.filter((result) => result.exitCode !== 0);
  assert.deepEqual(
    failed.map((result) => ({ id: result.id, exitCode: result.exitCode, outputTail: result.outputTail })),
    [],
    '历史债务入口必须全部转绿；详细输出见 test-results/historical-debt/command-results.json',
  );
});

test('historical debt cannot be bypassed by skips, only markers, or script shrinkage', async () => {
  /**
   * 业务场景：历史债务必须被修复或按最新意图更新，不能从默认入口里悄悄移走。
   */
  const packageJson = JSON.parse(await readRepoFile('package.json')) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  assert.match(scripts.typecheck ?? '', /typecheck:test/);
  assert.equal(scripts['test:server'], 'tsx --test tests/backend/*.test.ts');
  assert.match(scripts['test:spec:node'] ?? '', /scripts\/list-node-spec-tests\.mjs/);

  const listScript = await readRepoFile('scripts/list-node-spec-tests.mjs');
  for (const historicalFile of ['project_chat_config_v2', 'codex_project_discovery_conf_v2', 'layered_quality_gates']) {
    assert.doesNotMatch(listScript, new RegExp(`${historicalFile}[\\s\\S]{0,120}(exclude|filter|skip|ignore)`, 'i'));
  }

  const testFiles = [
    ...(await collectFiles('tests/backend')).filter((file) => file.endsWith('.test.ts')),
    ...(await collectFiles('tests/spec')).filter((file) => /\.(test|spec|ts)$/.test(file)),
    ...(await collectFiles('tests/specs')).filter((file) => /\.(test|spec)\.(ts|tsx)$/.test(file)),
  ];
  const offenders: string[] = [];
  for (const file of testFiles) {
    const source = await readRepoFile(file);
    if (FORBIDDEN_TEST_SHORTCUTS.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `默认测试不得新增 skip/only/todo 绕过债务: ${offenders.join(', ')}`);
});

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * 读取仓库真实文件，保证合同检查的是执行器会修改的生产入口和测试入口。
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

function buildStandaloneGateEnv(): NodeJS.ProcessEnv {
  /**
   * 子门禁本身也是 node:test；清掉父测试上下文，确保 spawn 的默认门禁真实执行。
   */
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'NODE_TEST_CONTEXT' || key.startsWith('NODE_TEST_')) {
      delete env[key];
    }
  }
  return env;
}

async function collectFiles(relativeDir: string): Promise<string[]> {
  /**
   * 递归收集测试文件，静态检查默认门禁没有被偷懒跳过。
   */
  const absoluteDir = path.join(REPO_ROOT, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) return collectFiles(relativePath);
    return [relativePath];
  }));
  return nested.flat().sort();
}
