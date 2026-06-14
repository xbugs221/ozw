/**
 * 61-优化Pi会话模型选择直接显示下拉框
 *
 * 契约测试 1：SessionModelControls 直接渲染两个下拉框而非 trigger+panel
 * 契约测试 2：已完成工具卡片默认展开
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('SessionModelControls no longer uses trigger button and floating panel', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/SessionModelControls.tsx');

  // Must NOT use createPortal (floating panel)
  assert.doesNotMatch(source, /createPortal/, 'SessionModelControls must not use createPortal for floating panel');

  // Must NOT have buttonRef for trigger
  assert.doesNotMatch(source, /buttonRef/, 'SessionModelControls must not have buttonRef');

  // Must NOT have isOpen state for panel toggle
  assert.doesNotMatch(source, /\bisOpen\b/, 'SessionModelControls must not have isOpen state');

  // Must NOT have dropdownRef
  assert.doesNotMatch(source, /dropdownRef/, 'SessionModelControls must not have dropdownRef');

  // Must NOT have the old trigger button test id
  assert.doesNotMatch(source, /session-model-controls-trigger/, 'SessionModelControls must not have old trigger button test id');
});

test('SessionModelControls directly renders two inline select elements', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/SessionModelControls.tsx');

  // Must render at least two <select> elements
  const selectMatches = source.match(/<select/g);
  assert.ok(selectMatches && selectMatches.length >= 2, 'SessionModelControls must directly render two <select> elements');

  // Must have model select with data-testid
  assert.match(source, /data-testid="session-model-select"/, 'SessionModelControls must have data-testid="session-model-select"');

  // Must have depth select with data-testid
  assert.match(source, /data-testid="session-depth-select"/, 'SessionModelControls must have data-testid="session-depth-select"');
});

test('SessionModelControls keeps PiLogo conditional rendering', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/SessionModelControls.tsx');

  // PiLogo import must remain
  assert.match(source, /import\s+PiLogo/, 'SessionModelControls must still import PiLogo');
});

test('Tool card commands are always visible and output area uses independent collapsible details, not outer card open attribute', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // Tool cards must be rendered as <div> (not <details>) so commands are always visible.
  // The outer element for isToolUse messages must NOT use a <details> open attribute pattern.
  const hasOldDetailsPattern = /open\s*=\s*\{\s*isRunningTool\s*\|\|\s*isToolCard/.test(source);
  assert.ok(!hasOldDetailsPattern, 'Must not use old details open={isRunningTool || isToolCard} pattern — tool cards are now <div>');

  // Output section must exist as independent <details> with summary "Output"
  assert.match(source, /<summary[^>]*>\s*Output\s*<\/summary>/, 'Must have Output summary for independent collapsible output');

  // Error results must be inside their own <details> with tool-result id
  assert.match(source, /id=\{`tool-result-\$\{message\.toolId\}`\}/, 'Must have tool-result id for anchor-based collapse');

  // Must NOT have the old pattern that excluded completed tools from details
  const hasOldClosedPattern = /open\s*=\s*\{\s*isRunningTool\s*\|\|\s*!isToolCard/.test(source);
  assert.ok(!hasOldClosedPattern, 'Must not use old pattern open={isRunningTool || !isToolCard || undefined}');
});

test('ChatComposer still passes all SessionModelControls props', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/ChatComposer.tsx');

  // Must still render SessionModelControls
  assert.match(source, /SessionModelControls/, 'ChatComposer must still render SessionModelControls');

  // Must pass piModelOptions prop
  assert.match(source, /piModelOptions=\{piModelOptions\}/, 'ChatComposer must pass piModelOptions to SessionModelControls');

  // Must pass piThinkingOptions prop
  assert.match(source, /piThinkingOptions=\{piThinkingOptions\}/, 'ChatComposer must pass piThinkingOptions to SessionModelControls');
});

test('handleGetSessionMessages does not return empty for running Pi sessions with no liveMessages', () => {
  const source = readRepoFile('backend/session-messages-handler.ts');

  // The live snapshot check must allow running sessions to fall through
  // to subsequent recovery paths when liveMessages is empty.
  // Old: if (liveSnapshot && liveSnapshot.length > 0) { return ... }
  // Must NOT have: if (liveSnapshot) { return empty }
  // Instead it must use: if (liveSnapshot !== null && liveSnapshot.length > 0) or equivalent
  // so that a running session with empty liveMessages doesn't early-return.
  assert.match(source, /liveSnapshot\s*!==\s*null/, 'liveSnapshot check must use !== null to allow empty liveMessages for running sessions');
  assert.doesNotMatch(source, /if\s*\(\s*liveSnapshot\s*&&\s*liveSnapshot\.length\s*>\s*0\s*\)\s*\{[\s\S]{0,200}return\s+res\.json/, '"if (liveSnapshot && liveSnapshot.length > 0)" would early-return for empty liveMessages in running state');
});

test('handleGetSessionMessages falls back to snapshot bridge when JSONL returns empty for Pi', () => {
  const source = readRepoFile('backend/session-messages-handler.ts');

  // Must have snapshot fallback after getPiSessionMessages returns empty
  const hasSnapshotFallback = /getPiSessionCompletedSnapshot[\s\S]{0,500}messages.*length\s*>\s*0|getPiSessionCompletedSnapshot[\s\S]{0,500}snapshot.*length/.test(source);
  assert.ok(hasSnapshotFallback, 'handleGetSessionMessages must fall back to getPiSessionCompletedSnapshot when JSONL returns empty');
});
