/**
 * PURPOSE: 约束测试类型基线、Codex JSONL fixture discovery 和 provider
 * browser harness 保持为可复用基础设施，避免后续回归重新复制局部 mock。
 *
 * Sources: 4-测试基线与Fixture真实化
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const EVIDENCE_CONTRACTS = [
  'typecheck-test-log -> test-results/typecheck-test/typecheck.log',
  'codex-fixture-discovery-state -> test-results/codex-fixture-discovery/state.json',
  'codex-fixture-browser-trace -> test-results/codex-fixture-discovery/browser-trace.zip',
  'provider-harness-source-audit -> test-results/provider-runtime-harness/source-audit.json',
];

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * PURPOSE: 从仓库根读取真实源码，让规格测试审计当前测试入口和 helper 边界。
   */
  return fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

function exposesHelper(source: string, symbol: string): boolean {
  /**
   * PURPOSE: 判断 helper 是否以公开导出形式暴露，防止测试只匹配内部实现文本。
   */
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+${escaped}\\b`).test(source);
}

test('测试类型检查入口仍是根 typecheck 的合并门禁', async () => {
  /**
   * 业务场景：测试 mock 或 browser harness 类型漂移时，合并门禁必须直接失败。
   */
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('typecheck-test-log')));
  const packageJson = JSON.parse(await readRepoFile('package.json')) as { scripts?: Record<string, string> };
  const tsconfig = JSON.parse(await readRepoFile('tsconfig.test.json')) as {
    include?: string[];
    compilerOptions?: Record<string, unknown>;
  };

  assert.equal(packageJson.scripts?.['typecheck:test'], 'tsc -p tsconfig.test.json --noEmit');
  assert.match(packageJson.scripts?.typecheck || '', /typecheck:test/);
  assert.ok(Array.isArray(tsconfig.include), 'tsconfig.test.json 必须显式列出测试源码');
  assert.ok(JSON.stringify(tsconfig).includes('tests'), 'test typecheck 必须覆盖仓库测试');
  assert.notEqual(tsconfig.compilerOptions?.noImplicitAny, false, 'test typecheck 不得全局关闭 implicit-any');
});

test('共享 Codex JSONL 和 discovery helper 定义真实 fixture 合同', async () => {
  /**
   * 业务场景：browser spec 写入 Codex 历史时，应复用同一 JSONL 结构和项目 API discovery。
   */
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('codex-fixture-discovery-state')));
  const jsonlFixture = await readRepoFile('tests/spec/helpers/codex-jsonl-fixture.ts');
  const discovery = await readRepoFile('tests/spec/helpers/fixture-session-discovery.ts');

  assert.ok(exposesHelper(jsonlFixture, 'writeCodexSessionFixture'), 'Codex JSONL 写入必须是共享 helper');
  assert.ok(exposesHelper(jsonlFixture, 'appendCodexSessionEntries'), 'Codex JSONL 追加必须是共享 helper');
  assert.match(jsonlFixture, /session_meta/);
  assert.match(jsonlFixture, /function_call/);
  assert.ok(exposesHelper(discovery, 'waitForCodexFixtureSession'), 'fixture discovery wait 必须是共享 helper');
  assert.match(discovery, /routeIndex/);
  assert.match(discovery, /providerSessionId/);
  assert.match(discovery, /candidate/i, 'discovery 失败必须包含候选 session 诊断');
});

test('历史易碎 Codex browser specs 使用共享 fixture discovery', async () => {
  /**
   * 业务场景：历史失败用例必须进入真实页面断言，而不是在 session discovery 前失败。
   */
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('codex-fixture-browser-trace')));
  const firstTurn = await readRepoFile('tests/spec/codex-first-turn-rendering.spec.ts');
  const proposal92 = await readRepoFile('tests/spec/proposal-92-provider-non-streaming-render.spec.ts');

  for (const [name, source] of Object.entries({ firstTurn, proposal92 })) {
    assert.match(source, /waitForCodexFixtureSession/, `${name} 必须使用共享 discovery helper`);
    assert.doesNotMatch(
      source,
      /throw new Error\(`Codex fixture session \$\{sessionId\} not found`\)/,
      `${name} 不得保留不透明 fixture-not-found 错误`,
    );
  }
});

test('provider browser specs 使用同一共享 WebSocket harness', async () => {
  /**
   * 业务场景：provider runtime 事件格式变化时，browser specs 应通过共享 harness 同步更新。
   */
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('provider-harness-source-audit')));
  const harness = await readRepoFile('tests/spec/helpers/provider-runtime-harness.ts');
  const chatRuntime = await readRepoFile('tests/spec/chat-composer-runtime.spec.ts');
  const frontendNoise = await readRepoFile('tests/spec/frontend-runtime-noise-and-codex-render.spec.ts');

  for (const symbol of [
    'installProviderRuntimeHarness',
    'emitMessageAccepted',
    'emitSessionStatus',
    'emitProviderResponse',
    'emitProviderComplete',
    'emitProviderError',
  ]) {
    assert.ok(exposesHelper(harness, symbol), `provider runtime harness 必须暴露 ${symbol}`);
  }

  assert.match(chatRuntime, /provider-runtime-harness/);
  assert.match(frontendNoise, /provider-runtime-harness/);
  for (const [name, source] of Object.entries({ chatRuntime, frontendNoise })) {
    assert.doesNotMatch(source, /class\s+\w*Socket\s+extends\s+EventTarget/, `${name} 不得定义本地 socket class`);
    assert.doesNotMatch(source, /window\.WebSocket\s*=/, `${name} 不得替换共享 harness WebSocket`);
  }
});
