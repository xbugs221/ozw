/**
 * Sources: 2026-06-16-11-聊天输入发送与会话控制面重构
 *
 * PURPOSE: Audit the real chat frontend so composer and session loading rules
 * stay in focused business modules instead of oversized public hooks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = process.cwd();

/**
 * Read a repository file as UTF-8 text.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Count direct network calls inside a hook source file.
 */
function countDirectNetworkCalls(source: string): number {
  return (source.match(/authenticatedFetch\(|api\.[A-Za-z0-9_]+/g) || []).length;
}

test('chat composer and session control modules exist', async () => {
  const expectedModules = [
    'frontend/components/chat/composer/composerDraftState.ts',
    'frontend/components/chat/composer/attachmentQueue.ts',
    'frontend/components/chat/composer/submitDedupPolicy.ts',
    'frontend/components/chat/composer/chatSubmitController.ts',
    'frontend/components/chat/composer/sessionControlState.ts',
    'frontend/components/chat/session/sessionMessageLoader.ts',
    'frontend/components/chat/session/sessionScrollAnchor.ts',
    'frontend/components/chat/session/sessionRecoveryStore.ts',
    'frontend/components/chat/session/terminalReconcileController.ts',
  ];

  for (const modulePath of expectedModules) {
    const absolutePath = path.join(REPO_ROOT, modulePath);
    assert.equal(existsSync(absolutePath), true, `${modulePath} must exist after chat control split`);
    const source = await readRepoFile(modulePath);
    assert.match(source, /PURPOSE|目的|composer|session|attachment|submit|control|loader/i, `${modulePath} must explain its chat business role`);
    assert.match(source, /export\s+(function|const|type|interface)/, `${modulePath} must export a tested business entry`);
  }
});

test('chat hooks stay as composition layers', async () => {
  const composerSource = await readRepoFile('frontend/components/chat/hooks/useChatComposerState.ts');
  const sessionSource = await readRepoFile('frontend/components/chat/hooks/useChatSessionState.ts');
  const composerLines = composerSource.split(/\r?\n/).length;
  const sessionLines = sessionSource.split(/\r?\n/).length;
  const totalNetworkCalls = countDirectNetworkCalls(composerSource) + countDirectNetworkCalls(sessionSource);
  const heavyMarkers = [
    'MAX_CHAT_ATTACHMENT_BYTES',
    'SUBMIT_DEDUP_WINDOW_MS',
    'USER_MESSAGE_DELIVERY_TIMEOUT_MS',
    'loadMessagesUntilTarget',
    'loadAllMessages',
    'LOCAL_RECOVERY_MESSAGE_LIMIT',
  ];
  const stillOwnedMarkers = heavyMarkers.filter((marker) => composerSource.includes(marker) || sessionSource.includes(marker));

  assert.ok(composerLines <= 650, `useChatComposerState.ts should be a composition hook; current line count is ${composerLines}`);
  assert.ok(sessionLines <= 850, `useChatSessionState.ts should be a composition hook; current line count is ${sessionLines}`);
  assert.ok(totalNetworkCalls <= 3, `chat hooks should delegate network planning; found ${totalNetworkCalls} direct calls`);
  assert.deepEqual(stillOwnedMarkers, [], `chat hooks still own control constants/helpers: ${stillOwnedMarkers.join(', ')}`);
});

test('chat control modules are used by production paths', async () => {
  const productionSources = [
    await readRepoFile('frontend/components/chat/composer/useChatComposerStateImpl.ts'),
    await readRepoFile('frontend/components/chat/session/useChatSessionStateImpl.ts'),
    await readRepoFile('frontend/components/chat/view/ChatInterface.tsx'),
  ].join('\n');
  const expectedImports = [
    './attachmentQueue',
    './chatSubmitController',
    './composerDraftState',
    './submitDedupPolicy',
    '../composer/sessionControlState',
    './sessionMessageLoader',
    './sessionRecoveryStore',
    './sessionScrollAnchor',
    './terminalReconcileController',
  ];

  for (const importPath of expectedImports) {
    assert.match(
      productionSources,
      new RegExp(`from ['"]${importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
      `${importPath} must be imported by a production chat path`,
    );
  }
});

test('existing chat specs keep send, merge, and file mention contracts visible', async () => {
  const composerSpec = await readRepoFile('tests/spec/chat-composer-runtime.spec.ts');
  const mergeSpec = await readRepoFile('tests/specs/chat-message-merge-core.spec.ts');
  const fileMentionSpec = await readRepoFile('tests/spec/chat_file_mention_search.ts');

  assert.match(composerSpec, /reasoning|steer|model|composer|发送|会话/i, 'composer runtime spec must cover send and control behavior');
  assert.match(mergeSpec, /delta append|optimistic|persisted|reducer/i, 'merge core spec must cover session loading consistency');
  assert.match(fileMentionSpec, /fuzzy|模糊|token|file/i, 'file mention spec must cover fuzzy search behavior');
});
