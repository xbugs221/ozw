/**
 * PURPOSE: Contract tests for Codex reasoning-effort flow from UI selector
 * through WebSocket message to app-server turn/start.
 *
 * These tests verify that the user's thinking-depth selection survives
 * the full pipeline without being overwritten by model catalog defaults,
 * session state sync, or other effects.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// 1. Frontend state: reasoningEffort is stored in localStorage and not
//    overwritten by model catalog load when user has explicitly chosen
// ---------------------------------------------------------------------------

test('useChatProviderState reads codex reasoningEffort from localStorage with fallback', () => {
  const source = readRepoFile('frontend/components/chat/hooks/useChatProviderState.ts');

  // getStoredCodexReasoningEffort must read localStorage and fallback to CODEX_REASONING_EFFORTS.DEFAULT
  assert.match(
    source,
    /localStorage\.getItem\(['"]codex-reasoning-effort['"]\)/,
    'Must read codex-reasoning-effort from localStorage',
  );
  assert.match(
    source,
    /CODEX_REASONING_EFFORTS\.DEFAULT/,
    'Must fallback to CODEX_REASONING_EFFORTS.DEFAULT when localStorage is empty',
  );
});

test('Codex reasoningEffort is persisted to localStorage on change', () => {
  const source = readRepoFile('frontend/components/chat/hooks/useChatProviderState.ts');

  // setCodexReasoningEffort must call localStorage.setItem
  assert.match(
    source,
    /localStorage\.setItem\(['"]codex-reasoning-effort['"]/,
    'Must persist codex reasoning effort to localStorage on change',
  );
});

test('Codex session sync does not depend on local reasoningEffort changes', () => {
  const source = readRepoFile('frontend/components/chat/hooks/useChatProviderState.ts');
  const effectStart = source.indexOf('const sessionReasoningEffort = typeof selectedSession?.reasoningEffort');
  assert.notEqual(effectStart, -1, 'Must keep Codex selectedSession reasoning sync effect');
  const effectBlock = source.slice(effectStart, effectStart + 900);

  assert.match(
    effectBlock,
    /codexReasoningEffortRef\.current/,
    'Session sync must compare against a ref so local select changes do not retrigger stale selectedSession sync',
  );
  assert.doesNotMatch(
    effectBlock,
    /\n\s*codexReasoningEffort,\n/,
    'Session sync dependencies must not include local codexReasoningEffort',
  );
});

test('Codex reasoningEffort effect guards against resetting valid user selection', () => {
  const source = readRepoFile('frontend/components/chat/hooks/useChatProviderState.ts');

  // The effect that checks if current reasoningEffort is in the model's reasoning options
  // must return early (not reset) if the value IS in the options
  const effectBlock = source.slice(
    source.indexOf('const activeModel = getCodexModelOption(codexModelOptions, codexModel)'),
    source.indexOf('const activeModel = getCodexModelOption(codexModelOptions, codexModel)') + 500,
  );
  assert.match(
    effectBlock,
    /reasoningValues\.has\(codexReasoningEffort\)/,
    'Effect must check if current reasoningEffort is in model reasoning options',
  );
  // After the check, it should return (not reset) if the value is valid
  assert.match(
    effectBlock,
    /return/,
    'Effect must return early when current reasoningEffort is valid for the model',
  );
});

// ---------------------------------------------------------------------------
// 2. Frontend → WebSocket: submitComposerInput includes reasoningEffort
//    in the codex-command options
// ---------------------------------------------------------------------------

test('useChatComposerState sends reasoningEffort in codex-command options', () => {
  const source = readRepoFile('frontend/components/chat/hooks/useChatComposerState.ts');

  // When provider is codex, the sendMessage call must include reasoningEffort in options
  const codexBranch = source.slice(
    source.indexOf("if (provider === 'codex')"),
    source.indexOf('} else if (provider === \'pi\')'),
  );
  assert.match(
    codexBranch,
    /reasoningEffort:\s*codexReasoningEffort/,
    'codex-command options must include reasoningEffort field',
  );
});

// ---------------------------------------------------------------------------
// 3. Server: codex-command handler passes reasoningEffort through to
//    sendNativeMessage
// ---------------------------------------------------------------------------

test('server codex-command handler preserves reasoningEffort from frontend', () => {
  const source = readRepoFile('backend/index.ts');

  // Locate the codex-command handler block
  const handlerStart = source.indexOf("data.type === 'codex-command'");
  assert.notEqual(handlerStart, -1, 'backend/index.ts must handle codex-command');
  // The codex-command handler is ~4350 chars long; use 5000 to be safe
  const handlerBlock = source.slice(handlerStart, handlerStart + 5000);

  // Must call sendNativeMessage with reasoningEffort
  assert.match(
    handlerBlock,
    /reasoningEffort:\s*codexOptions\?\.reasoningEffort/,
    'sendNativeMessage must receive reasoningEffort from codexOptions',
  );

  // codexOptions must merge sessionModelState.reasoningEffort || codexProviderOptions?.reasoningEffort
  assert.match(
    handlerBlock,
    /sessionModelState\.reasoningEffort\s*\|\|\s*codexProviderOptions\?\.reasoningEffort/,
    'codexOptions.reasoningEffort must fallback from sessionModelState to codexProviderOptions',
  );
});

test('resolveChatProjectOptions preserves unknown options fields', () => {
  const source = readRepoFile('backend/chat-project-path.ts');

  // The spread ...options must preserve extra fields like reasoningEffort
  assert.match(
    source,
    /\.\.\.options/,
    'resolveChatProjectOptions must spread options to preserve reasoningEffort',
  );
});

// ---------------------------------------------------------------------------
// 4. App-server: turn/start receives effort parameter
// ---------------------------------------------------------------------------

test('codex-app-server-runtime sends effort in turn/start request', () => {
  const source = readRepoFile('backend/codex-app-server-runtime.ts');

  // The turn/start request must include effort parameter from input.reasoningEffort
  const turnStartBlock = source.slice(
    source.indexOf("transport.request('turn/start'"),
    source.indexOf("transport.request('turn/start'") + 300,
  );
  assert.match(
    turnStartBlock,
    /effort:\s*input\.reasoningEffort/,
    'turn/start request must include effort from input.reasoningEffort',
  );
});

// ---------------------------------------------------------------------------
// 5. Session selection must not overwrite user choice for new sessions
// ---------------------------------------------------------------------------

test('ChatInterface does not sync reasoningEffort for unsaved/empty sessions', () => {
  const source = readRepoFile('frontend/components/chat/view/ChatInterface.tsx');

  // The syncSessionModelState effect must guard against unsaved sessions
  assert.match(
    source,
    /isUnsavedSessionId/,
    'ChatInterface must check isUnsavedSessionId before syncing model state',
  );
});
