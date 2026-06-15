/**
 * PURPOSE: Contract tests for proposal 6. They keep chat live rendering,
 * delivery status transitions, and file-opening tool cards behind explicit
 * helpers instead of scattered string checks.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_CONTRACTS = [
  'delivery-status-state -> test-results/chat-live-tooling/delivery-status-state.json',
  'live-before-jsonl-screenshot -> test-results/chat-live-tooling/live-before-jsonl.png',
  'tool-open-file-screenshot -> test-results/chat-live-tooling/tool-open-file.png',
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
 * Assert source exposes a named function or const.
 *
 * @param source Source text.
 * @param symbol Exported helper expected by this proposal.
 */
function assertExports(source: string, symbol: string): void {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(source, new RegExp(`export\\s+(?:function|const)\\s+${escaped}\\b`));
}

test('deliveryStatus transitions are centralized in a state machine', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('delivery-status-state')));
  const machine = await readRepoFile('frontend/components/chat/state/deliveryStatusMachine.ts');
  const reducer = await readRepoFile('frontend/components/chat/state/chatMessageReducer.ts');

  assertExports(machine, 'markAcceptedDeliveryPersisted');
  assertExports(machine, 'markPendingDeliveryFailed');
  assertExports(machine, 'markDeliveredByPersistedEcho');
  assert.match(machine, /accepted[\s\S]{0,120}persisted/i);
  assert.match(reducer, /deliveryStatusMachine|markAcceptedDeliveryPersisted/);
  assert.doesNotMatch(reducer, /acceptedIndex[\s\S]{0,120}deliveryStatus:\s*'persisted'/, 'accepted transition should not be inline reducer string logic');
});

test('live-before-JSONL merge policy is a shared boundary', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('live-before-jsonl-screenshot')));
  const policy = await readRepoFile('frontend/components/chat/utils/liveTurnMergePolicy.ts');
  const sessionState = await readRepoFile('frontend/components/chat/hooks/useChatSessionState.ts');
  const merge = await readRepoFile('frontend/components/chat/utils/sessionMessageMerge.ts');
  const mergeSpec = await readRepoFile('tests/specs/chat-message-merge-core.spec.ts');

  assertExports(policy, 'shouldPreserveAcceptedOptimisticUser');
  assertExports(policy, 'shouldPreserveLiveTurnDuringEmptyReload');
  assertExports(policy, 'canRenderLiveRowForAcceptedTurn');
  assert.match(sessionState, /liveTurnMergePolicy|shouldPreserveAcceptedOptimisticUser/);
  assert.match(merge, /liveTurnMergePolicy|canRenderLiveRowForAcceptedTurn/);
  assert.match(mergeSpec, /accepted Codex live turn renders before JSONL history catches up/);
});

test('open-file tool card configuration is shared by image and file tools', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('tool-open-file-screenshot')));
  const helper = await readRepoFile('frontend/components/chat/tools/configs/openFileToolConfig.ts');
  const configs = await readRepoFile('frontend/components/chat/tools/configs/toolConfigs.ts');
  const renderingParity = await readRepoFile('tests/specs/chat-rendering-parity.spec.tsx');

  assertExports(helper, 'createOpenFileToolConfig');
  assertExports(helper, 'createImageOpenFileToolConfig');
  assert.match(configs, /createImageOpenFileToolConfig/);
  assert.match(configs, /view_image:\s*createImageOpenFileToolConfig/);
  assert.match(configs, /'functions\.view_image':\s*createImageOpenFileToolConfig/);
  assert.doesNotMatch(configs, /view_image:[\s\S]{0,260}'functions\.view_image':[\s\S]{0,260}getValue/, 'view_image aliases should not duplicate inline open-file config');
  assert.match(renderingParity, /direct clickable file-open control/);
});

test('browser regression keeps visual status and image-open assertions', async () => {
  const browserSpec = await readRepoFile('tests/spec/chat-composer-runtime.spec.ts');

  assert.match(browserSpec, /toHaveCSS\('background-color',\s*'rgb\(22, 163, 74\)'\)/);
  assert.match(browserSpec, /CHAT_RUNTIME_LIVE_BEFORE_JSONL/);
  assert.match(browserSpec, /view_image tool card path opens the image preview/);
  assert.match(browserSpec, /getByRole\('img'/);
  assert.match(browserSpec, /files\/content|writeViewImageCodexFixture/);
});
