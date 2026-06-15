/**
 * Sources: 2026-06-16-5-Provider运行边界与AppServer重构
 *
 * PURPOSE: Verify the backend provider runtime boundary keeps Codex
 * app-server, Pi SDK, route binding, active-turn and live transcript ownership
 * separated in production source.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_CONTRACTS = [
  'provider-runtime-source-audit -> test-results/provider-runtime/source-audit.json',
  'provider-binding-state -> test-results/provider-runtime/binding-state.json',
  'active-turn-runtime-log -> test-results/provider-runtime/active-turn-runtime.log',
];

/**
 * Read a repository file as UTF-8 text.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Assert that a module exposes a named function or const.
 */
function assertExports(source: string, symbol: string): void {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(source, new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${escaped}\\b`));
}

test('provider runtime boundary modules exist and keep Codex on app-server', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('provider-runtime-source-audit')));
  const router = await readRepoFile('backend/domains/provider-runtime/runtime-router.ts');
  const events = await readRepoFile('backend/domains/provider-runtime/provider-runtime-events.ts');
  const nativeRuntime = await readRepoFile('backend/native-agent-runtime.ts');
  const packageJson = await readRepoFile('package.json');

  assertExports(router, 'sendProviderRuntimeMessage');
  assert.match(router, /sendCodexAppServerMessage/, 'Codex branch must call app-server facade');
  assert.match(router, /createAgentSession|sendPiRuntimeMessage/, 'Pi branch must remain explicit');
  assertExports(events, 'toProviderSessionStatusEvent');
  assertExports(events, 'toProviderRuntimeErrorEvent');
  assert.doesNotMatch(nativeRuntime, /@openai\/codex-sdk/);
  assert.doesNotMatch(packageJson, /"@openai\/codex-sdk"/);
});

test('cN route/provider session binding is centralized', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('provider-binding-state')));
  const binding = await readRepoFile('backend/domains/provider-runtime/provider-session-binding.ts');
  const chatWebsocket = await readRepoFile('backend/server/chat-websocket.ts');
  const messagesHandler = await readRepoFile('backend/session-messages-handler.ts');

  for (const symbol of [
    'readProviderSessionBinding',
    'writeProviderSessionBinding',
    'resolveProviderSessionBinding',
    'assertProviderSessionProject',
  ]) {
    assertExports(binding, symbol);
  }

  assert.match(chatWebsocket, /provider-session-binding/);
  assert.match(messagesHandler, /provider-session-binding/);
  assert.doesNotMatch(chatWebsocket, /providerSessionIdForMerge\s*=/, 'chat websocket should not recreate message handler binding logic');
});

test('active-turn overlay and live transcript stores have separate lifecycles', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('active-turn-runtime-log')));
  const activeTurn = await readRepoFile('backend/domains/provider-runtime/active-turn-store.ts');
  const liveTranscript = await readRepoFile('backend/domains/provider-runtime/live-transcript-store.ts');
  const messagesHandler = await readRepoFile('backend/session-messages-handler.ts');

  assertExports(activeTurn, 'getProviderActiveTurnOverlay');
  assertExports(activeTurn, 'clearProviderActiveTurnOverlay');
  assertExports(liveTranscript, 'getProviderLiveTranscriptSnapshot');
  assertExports(liveTranscript, 'clearProviderLiveTranscriptSnapshot');
  assert.match(messagesHandler, /getProviderActiveTurnOverlay/);
  assert.match(messagesHandler, /getProviderLiveTranscriptSnapshot/);
  assert.doesNotMatch(activeTurn, /liveMessages/);
  assert.doesNotMatch(liveTranscript, /activeTurn/);
});

test('native-agent-runtime is reduced to coordination instead of owning every rule', async () => {
  const nativeRuntime = await readRepoFile('backend/native-agent-runtime.ts');
  const lineCount = nativeRuntime.split(/\r?\n/).length;

  assert.ok(lineCount < 700, `native-agent-runtime.ts should be under 700 lines after boundary extraction, got ${lineCount}`);
  assert.match(nativeRuntime, /sendProviderRuntimeMessage|runtime-router/);
  assert.doesNotMatch(nativeRuntime, /function\s+mapCodexNativeToolItem/);
  assert.doesNotMatch(nativeRuntime, /function\s+mergeHistoryWithActiveTurnOverlay/);
});
