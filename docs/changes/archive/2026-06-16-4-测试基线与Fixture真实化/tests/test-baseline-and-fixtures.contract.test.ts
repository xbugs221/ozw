/**
 * PURPOSE: Contract tests for proposal 4. They audit the real repository
 * testing baseline, Codex fixture helpers, and provider browser harness so
 * later changes can rely on stable tests instead of duplicated mocks.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_CONTRACTS = [
  'typecheck-test-log -> test-results/typecheck-test/typecheck.log',
  'codex-fixture-discovery-state -> test-results/codex-fixture-discovery/state.json',
  'codex-fixture-browser-trace -> test-results/codex-fixture-discovery/browser-trace.zip',
  'provider-harness-source-audit -> test-results/provider-runtime-harness/source-audit.json',
];

/**
 * Read a repository file as UTF-8 text.
 *
 * @param relativePath Path relative to the repository root.
 * @returns File contents.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Return true when a source file contains a named export or function.
 *
 * @param source File contents.
 * @param symbol Symbol that must be visible to tests.
 * @returns Whether the symbol appears as a public helper.
 */
function exposesHelper(source: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+${escaped}\\b`).test(source);
}

test('typecheck:test remains part of the root typecheck contract', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('typecheck-test-log')));
  const packageJson = JSON.parse(await readRepoFile('package.json')) as { scripts?: Record<string, string> };
  const tsconfig = JSON.parse(await readRepoFile('tsconfig.test.json')) as { include?: string[]; compilerOptions?: Record<string, unknown> };

  assert.equal(packageJson.scripts?.['typecheck:test'], 'tsc -p tsconfig.test.json --noEmit');
  assert.match(packageJson.scripts?.typecheck || '', /typecheck:test/);
  assert.ok(Array.isArray(tsconfig.include), 'tsconfig.test.json must explicitly list test sources');
  assert.ok(JSON.stringify(tsconfig).includes('tests'), 'test typecheck must still cover repository tests');
  assert.notEqual(tsconfig.compilerOptions?.noImplicitAny, false, 'test typecheck must not disable implicit-any checks globally');
});

test('shared Codex JSONL and discovery helpers define the real fixture contract', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('codex-fixture-discovery-state')));
  const jsonlFixture = await readRepoFile('tests/spec/helpers/codex-jsonl-fixture.ts');
  const discovery = await readRepoFile('tests/spec/helpers/fixture-session-discovery.ts');

  assert.ok(exposesHelper(jsonlFixture, 'writeCodexSessionFixture'), 'Codex JSONL fixture writer must be shared');
  assert.ok(exposesHelper(jsonlFixture, 'appendCodexSessionEntries'), 'Codex JSONL append helper must be shared');
  assert.match(jsonlFixture, /session_meta/);
  assert.match(jsonlFixture, /function_call/);
  assert.ok(exposesHelper(discovery, 'waitForCodexFixtureSession'), 'fixture discovery wait helper must be shared');
  assert.match(discovery, /routeIndex/);
  assert.match(discovery, /providerSessionId/);
  assert.match(discovery, /candidate/i, 'discovery failures must include candidate session diagnostics');
});

test('historically flaky Codex browser specs use shared fixture discovery', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('codex-fixture-browser-trace')));
  const firstTurn = await readRepoFile('tests/spec/codex-first-turn-rendering.spec.ts');
  const proposal92 = await readRepoFile('tests/spec/proposal-92-provider-non-streaming-render.spec.ts');

  for (const [name, source] of Object.entries({ firstTurn, proposal92 })) {
    assert.match(source, /waitForCodexFixtureSession/, `${name} must use shared discovery helper`);
    assert.doesNotMatch(source, /throw new Error\(`Codex fixture session \$\{sessionId\} not found`\)/, `${name} must not keep opaque fixture-not-found errors`);
  }
});

test('provider browser specs use one shared WebSocket harness', async () => {
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
    assert.ok(exposesHelper(harness, symbol), `provider runtime harness must expose ${symbol}`);
  }

  assert.match(chatRuntime, /provider-runtime-harness/);
  assert.match(frontendNoise, /provider-runtime-harness/);
  for (const [name, source] of Object.entries({ chatRuntime, frontendNoise })) {
    assert.doesNotMatch(source, /class\s+\w*Socket\s+extends\s+EventTarget/, `${name} must not define a local socket class`);
    assert.doesNotMatch(source, /window\.WebSocket\s*=/, `${name} must not replace the shared harness WebSocket`);
  }
});
