/**
 * PURPOSE: Contract tests for Codex/Pi thinking block rendering — shared
 * body-style text chrome, default collapse to latest 3 lines, expand/collapse
 * control, and tool call separation.
 *
 * These tests verify the frontend rendering logic, the native runtime
 * transcript reducer's handling of thinking/tool events, and the JSONL
 * message transformation preserves thinking/tool separation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractSourceRange(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start > 0 ? start : 0);
  return source.slice(Math.max(0, start), end > 0 ? end : source.length);
}

// ---------------------------------------------------------------------------
// 1. MessageComponent renders thinking blocks with truncation control
// ---------------------------------------------------------------------------

test('MessageComponent renders thinking blocks separately from tool cards', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // Thinking block rendering must have its own branch (message.isThinking check)
  assert.match(
    source,
    /message\.isThinking/,
    'MessageComponent must check message.isThinking for thinking block rendering',
  );

  // Tool use rendering must also have its own branch (message.isToolUse check)
  assert.match(
    source,
    /message\.isToolUse/,
    'MessageComponent must check message.isToolUse for tool card rendering',
  );

  // The thinking block branch should NOT contain ToolRenderer
  const thinkingBranch = extractSourceRange(source, 'message.isThinking ?', '\n            ) : (');
  // Thinking block should not render tool cards inside
  assert.ok(
    !thinkingBranch.includes('ToolRenderer') || thinkingBranch.indexOf('ToolRenderer') > thinkingBranch.indexOf('message.isToolUse'),
    'Thinking block must not contain ToolRenderer — tool cards must render in isToolUse branch',
  );
});

test('MessageComponent thinking block can be collapsed/expanded', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // The thinking block should have some collapse mechanism (line-clamp, details, or state-based truncation)
  // After the fix, there should be a truncation mechanism like "line-clamp-3" or text slicing
  // Pre-fix: we verify the current state to establish a baseline
  const hasTruncationMechanism =
    source.includes('line-clamp') ||
    source.includes('truncate') ||
    source.includes('details') ||
    source.includes('showMore') ||
    source.includes('expand');

  // This assertion is expected to FAIL before the fix is implemented
  assert.ok(
    hasTruncationMechanism,
    'Thinking block must have collapse/expand mechanism (line-clamp, details, or expand state) — ' +
    'this test is expected to fail before the fix',
  );
});

test('MessageComponent renders Codex/Pi thinking rows with body-style text chrome', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');
  const thinkingBranch = extractSourceRange(source, 'message.isThinking ?', '\n            ) : (');
  const taskBranch = extractSourceRange(source, 'message.isTaskNotification ?', '\n      ) : (');

  assert.ok(thinkingBranch, 'thinking branch must exist for Codex/Pi reasoning rows');
  assert.match(
    thinkingBranch,
    /className="text-sm text-gray-700 dark:text-gray-300"/,
    'thinking rows should use the same text color and size as assistant body text',
  );
  assert.match(
    thinkingBranch,
    /<Markdown/,
    'thinking rows must continue to render markdown content',
  );
  assert.doesNotMatch(
    thinkingBranch,
    /border-l-2|pl-4|italic|text-gray-600 dark:text-gray-400/,
    'thinking rows must not use the old gray left rail, extra indent, or muted italic text',
  );
  assert.ok(taskBranch, 'task notification branch must exist for Codex commentary rows');
  assert.match(
    taskBranch,
    /text-sm text-gray-700 dark:text-gray-300/,
    'in-progress Codex commentary rows should use body-style text chrome',
  );
  assert.doesNotMatch(
    taskBranch,
    /border-l-2 border-gray-300 dark:border-gray-600/,
    'in-progress Codex commentary rows must not use the old gray left rail',
  );
  assert.doesNotMatch(
    taskBranch,
    /bg-amber-400|dark:bg-amber-500/,
    'in-progress Codex commentary rows must not render an orange marker',
  );
});

// ---------------------------------------------------------------------------
// 2. Native runtime transcript reducer separates thinking from tool calls
// ---------------------------------------------------------------------------

test('reduceNativeRuntimeEvent creates isThinking entries separate from isToolUse entries', () => {
  const source = readRepoFile('frontend/components/chat/utils/nativeRuntimeTranscript.ts');

  // The reducer must mark thinking items with isThinking: true
  assert.match(
    source,
    /isThinking:\s*true/,
    'reduceNativeRuntimeEvent must set isThinking: true on reasoning/thinking message entries',
  );

  // Tool payload builder must set isToolUse: true
  assert.match(
    source,
    /isToolUse:\s*true/,
    'buildToolPayload must set isToolUse: true on tool call message entries',
  );

  // Thinking item processing and tool item processing must be separate code paths
  const thinkingPath = source.slice(
    source.indexOf('Thinking events without a stable itemId'),
    source.indexOf('const keyItemId'),
  );
  // The thinking path merges into existing thinking block or creates new one
  assert.match(
    thinkingPath,
    /last\.isThinking/,
    'Thinking merge path must check last.isThinking to merge into existing thinking block',
  );
});

// ---------------------------------------------------------------------------
// 3. Pi JSONL message transformation preserves thinking/tool separation
// ---------------------------------------------------------------------------

test('mapPiEntryToMessages separates thinking from toolCall content parts', () => {
  const source = readRepoFile('backend/projects.ts');
  const mapFnStart = source.indexOf('function mapPiEntryToMessages');
  assert.notEqual(mapFnStart, -1, 'projects.ts must define mapPiEntryToMessages');
  const mapFnEnd = source.indexOf('\nfunction extractCodexToolOutput', mapFnStart);
  const mapFnBlock = source.slice(mapFnStart, mapFnEnd > 0 ? mapFnEnd : mapFnStart + 3000);

  // Must handle item.type === 'thinking' separately
  assert.match(
    mapFnBlock,
    /type === ['"]thinking['"]/,
    'mapPiEntryToMessages must detect item.type === "thinking"',
  );

  // thinking items must produce type: 'thinking' messages
  assert.match(
    mapFnBlock,
    /type:\s*['"]thinking['"]/,
    'Thinking content parts must produce type: "thinking" message entries',
  );

  // toolCall items must produce type: 'tool_use' messages
  assert.match(
    mapFnBlock,
    /type === ['"]toolCall['"]/,
    'mapPiEntryToMessages must detect item.type === "toolCall"',
  );
  assert.match(
    mapFnBlock,
    /type:\s*['"]tool_use['"]/,
    'Tool call content parts must produce type: "tool_use" message entries',
  );
});

// ---------------------------------------------------------------------------
// 4. Pi message transform (JSONL → ChatMessage) preserves thinking flag
// ---------------------------------------------------------------------------

test('messageTransforms converts Pi thinking messages to isThinking ChatMessage', () => {
  const source = readRepoFile('frontend/components/chat/utils/messageTransforms.ts');

  // When message.type === 'thinking', must set isThinking: true
  assert.match(
    source,
    /message\.type === ['"]thinking['"]/,
    'messageTransforms must detect Pi thinking messages by type',
  );
  assert.match(
    source,
    /isThinking:\s*true/,
    'Pi thinking messages must be converted to ChatMessage with isThinking: true',
  );
});

test('messageTransforms converts Pi tool_use messages to isToolUse ChatMessage', () => {
  const source = readRepoFile('frontend/components/chat/utils/messageTransforms.ts');

  // When message.type === 'tool_use', must set isToolUse: true
  assert.match(
    source,
    /message\.type === ['"]tool_use['"]/,
    'messageTransforms must detect Pi tool_use messages by type',
  );
  assert.match(
    source,
    /isToolUse:\s*true/,
    'Pi tool_use messages must be converted to ChatMessage with isToolUse: true',
  );
});
