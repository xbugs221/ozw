/**
 * PURPOSE: Runtime integration test for the Pi running session merge pipeline.
 *
 * Unlike the source-level contract tests, this file actually imports and calls
 * normalizeLiveMessageToJsonlShape, makeMessageFingerprint, and
 * mergeAndDedupMessages with realistic JSONL-history and live-snapshot data,
 * verifying that:
 *
 * 1. JSONL messages are NEVER dropped by fingerprint collisions (fix for the
 *    review-2 blocker where all JSONL user/assistant/thinking messages had
 *    identical empty fingerprints because only `msg.content` was read).
 * 2. Live ChatMessageLike objects are correctly normalized to JSONL wire shape.
 * 3. Dedup correctly handles messageKey-based identity and content-based fallback.
 * 4. The merged result contains both JSONL history and normalized live messages.
 * 5. Non-overlapping JSONL + live messages all survive the merge.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeLiveMessageToJsonlShape,
  makeMessageFingerprint,
  mergeAndDedupMessages,
} from '../../../backend/session-messages-handler.js';

// ---------------------------------------------------------------------------
// Test data: realistic JSONL history (completed turns)
// ---------------------------------------------------------------------------

const JSONL_USER = {
  type: 'user',
  timestamp: '2026-06-03T13:00:00.000Z',
  provider: 'pi',
  messageKey: 'pi:sess:line:1:msg:0',
  message: { role: 'user', content: 'Explain the code in frontend/server.ts' },
};

const JSONL_THINKING = {
  type: 'thinking',
  timestamp: '2026-06-03T13:00:02.000Z',
  provider: 'pi',
  messageKey: 'pi:sess:line:2:msg:0',
  message: { role: 'assistant', content: 'Let me analyze the server architecture...' },
};

const JSONL_TOOL_USE = {
  type: 'tool_use',
  timestamp: '2026-06-03T13:00:03.000Z',
  provider: 'pi',
  messageKey: 'pi:sess:line:3:msg:0',
  toolName: 'Read',
  toolInput: { filePath: 'frontend/server.ts' },
  toolCallId: 'toolu_abc123',
};

const JSONL_ASSISTANT = {
  type: 'assistant',
  timestamp: '2026-06-03T13:00:05.000Z',
  provider: 'pi',
  messageKey: 'pi:sess:line:4:msg:0',
  message: { role: 'assistant', content: 'The server handles routing via Express...' },
};

// ---------------------------------------------------------------------------
// Test data: realistic live snapshot (current running turn)
// ---------------------------------------------------------------------------

const LIVE_THINKING = {
  type: 'assistant',
  content: 'I should also check the middleware chain...',
  provider: 'pi',
  source: 'pi-live',
  messageKey: 'pi:thinking-1',
  timestamp: '2026-06-03T13:01:00.000Z',
  isThinking: true,
};

const LIVE_TOOL_USE = {
  type: 'assistant',
  content: '',
  provider: 'pi',
  source: 'pi-live',
  messageKey: 'pi:toolu_def456',
  timestamp: '2026-06-03T13:01:02.000Z',
  toolName: 'Bash',
  toolInput: { command: 'wc -l frontend/server.ts' },
  toolCallId: 'toolu_def456',
  isToolUse: true,
};

const LIVE_ASSISTANT_DELTA = {
  type: 'assistant',
  content: 'Streaming response still in progress...',
  provider: 'pi',
  source: 'pi-live',
  messageKey: 'pi:delta-msg',
  timestamp: '2026-06-03T13:01:05.000Z',
};

// ---------------------------------------------------------------------------
// Tests: normalizeLiveMessageToJsonlShape
// ---------------------------------------------------------------------------

test('normalizeLiveMessageToJsonlShape converts isThinking live msg to JSONL thinking shape', () => {
  const result = normalizeLiveMessageToJsonlShape(LIVE_THINKING);
  assert.equal(result.type, 'thinking');
  assert.equal(result.message!.role, 'assistant');
  assert.equal(result.message!.content, 'I should also check the middleware chain...');
  assert.equal(result.messageKey, 'pi:thinking-1');
  // Must NOT have top-level content — frontend expects message.content
  assert.equal((result as any).content, undefined);
});

test('normalizeLiveMessageToJsonlShape converts isToolUse live msg to JSONL tool_use shape', () => {
  const result = normalizeLiveMessageToJsonlShape(LIVE_TOOL_USE);
  assert.equal(result.type, 'tool_use');
  assert.equal(result.toolName, 'Bash');
  assert.deepEqual(result.toolInput, { command: 'wc -l frontend/server.ts' });
  assert.equal(result.toolCallId, 'toolu_def456');
});

test('normalizeLiveMessageToJsonlShape converts plain assistant live msg to JSONL shape', () => {
  const result = normalizeLiveMessageToJsonlShape(LIVE_ASSISTANT_DELTA);
  assert.equal(result.type, 'assistant');
  assert.equal(result.message!.role, 'assistant');
  assert.equal(result.message!.content, 'Streaming response still in progress...');
});

test('normalizeLiveMessageToJsonlShape handles live tool_result', () => {
  const liveToolResult = {
    type: 'tool_result',
    provider: 'pi',
    messageKey: 'pi:tr-1',
    toolCallId: 'toolu_xyz',
    toolName: 'Bash',
    toolResult: '42 lines',
  };
  const result = normalizeLiveMessageToJsonlShape(liveToolResult);
  assert.equal(result.type, 'tool_result');
  assert.equal(result.output, '42 lines');
  assert.equal(result.toolCallId, 'toolu_xyz');
});

// ---------------------------------------------------------------------------
// Tests: makeMessageFingerprint — must not collide on identical types
// ---------------------------------------------------------------------------

test('makeMessageFingerprint uses messageKey as primary identity', () => {
  const fp1 = makeMessageFingerprint(JSONL_USER);
  const fp2 = makeMessageFingerprint(JSONL_THINKING);
  // Different messageKeys must produce different fingerprints
  assert.notEqual(fp1, fp2);
  assert.ok(fp1.startsWith('key:'));
  assert.ok(fp2.startsWith('key:'));
});

test('makeMessageFingerprint distinguishes same-type JSONL messages with different messageKeys', () => {
  const msgA = { ...JSONL_USER, messageKey: 'pi:sess:line:1:msg:0' };
  const msgB = { ...JSONL_USER, messageKey: 'pi:sess:line:2:msg:0', message: { role: 'user', content: 'Different question' } };
  assert.notEqual(makeMessageFingerprint(msgA), makeMessageFingerprint(msgB));
});

test('makeMessageFingerprint reads nested message.content for JSONL messages', () => {
  // JSONL messages have content under message.content, NOT at top-level msg.content
  const fp = makeMessageFingerprint(JSONL_USER);
  // Must NOT be a generic empty fingerprint like "user::::::"
  assert.ok(fp.includes('pi:sess'));
  assert.ok(!fp.endsWith('::::::'), `Fingerprint must not be empty-collision: ${fp}`);
});

test('makeMessageFingerprint reads top-level content for live/normalized messages', () => {
  const normalized = normalizeLiveMessageToJsonlShape(LIVE_THINKING);
  const fp = makeMessageFingerprint(normalized);
  assert.ok(fp.includes('pi:thinking-1'));
});

test('makeMessageFingerprint falls back to content hash when messageKey is missing', () => {
  const noKeyMsg = { type: 'assistant', message: { role: 'assistant', content: 'unique text' } };
  const fp = makeMessageFingerprint(noKeyMsg);
  assert.ok(fp.includes('unique text'));
  assert.ok(!fp.startsWith('key:'));
});

// ---------------------------------------------------------------------------
// Tests: mergeAndDedupMessages — the complete pipeline
// ---------------------------------------------------------------------------

test('mergeAndDedupMessages preserves all non-overlapping JSONL messages', () => {
  const jsonlHistory = [JSONL_USER, JSONL_THINKING, JSONL_TOOL_USE, JSONL_ASSISTANT];
  const liveSnapshot: any[] = []; // no live messages

  const merged = mergeAndDedupMessages(jsonlHistory, liveSnapshot);

  assert.equal(merged.length, 4, 'All 4 JSONL messages must be preserved');
  assert.equal(merged[0].type, 'user');
  assert.equal(merged[1].type, 'thinking');
  assert.equal(merged[2].type, 'tool_use');
  assert.equal(merged[3].type, 'assistant');
});

test('mergeAndDedupMessages preserves all live messages when JSONL is empty', () => {
  const jsonlHistory: any[] = [];
  const liveSnapshot = [LIVE_THINKING, LIVE_TOOL_USE, LIVE_ASSISTANT_DELTA];

  const merged = mergeAndDedupMessages(jsonlHistory, liveSnapshot);

  assert.equal(merged.length, 3, 'All 3 live messages must survive');
  // Live messages must be normalized to JSONL shape
  assert.equal(merged[0].type, 'thinking');
  assert.equal(merged[1].type, 'tool_use');
  assert.equal(merged[2].type, 'assistant');
  // Content must be under message.content, not top-level
  assert.equal(typeof merged[0].message?.content, 'string');
});

test('mergeAndDedupMessages merges JSONL history + live snapshot without duplication', () => {
  const jsonlHistory = [JSONL_USER, JSONL_THINKING, JSONL_TOOL_USE, JSONL_ASSISTANT];
  const liveSnapshot = [LIVE_THINKING, LIVE_TOOL_USE, LIVE_ASSISTANT_DELTA];

  const merged = mergeAndDedupMessages(jsonlHistory, liveSnapshot);

  // 4 JSONL + 3 live = 7 unique messages, none should be dropped
  assert.equal(merged.length, 7, `Expected 7 merged messages, got ${merged.length}`);

  // JSONL history must come first
  assert.equal(merged[0].messageKey, JSONL_USER.messageKey);
  assert.equal(merged[1].messageKey, JSONL_THINKING.messageKey);
  assert.equal(merged[2].messageKey, JSONL_TOOL_USE.messageKey);
  assert.equal(merged[3].messageKey, JSONL_ASSISTANT.messageKey);

  // Live snapshot must follow (normalized)
  const livePart = merged.slice(4);
  assert.equal(livePart[0].type, 'thinking');
  assert.equal(livePart[1].type, 'tool_use');
  assert.equal(livePart[2].type, 'assistant');
});

test('mergeAndDedupMessages deduplicates by messageKey when JSONL and live share the same key', () => {
  // Simulate a live message that corresponds to an already-persisted JSONL message
  const duplicateThinking = {
    type: 'assistant',
    content: 'I should check middleware...',
    provider: 'pi',
    messageKey: JSONL_THINKING.messageKey, // SAME key as JSONL thinking
    isThinking: true,
  };

  const jsonlHistory = [JSONL_USER, JSONL_THINKING];
  const liveSnapshot = [duplicateThinking, LIVE_TOOL_USE];

  const merged = mergeAndDedupMessages(jsonlHistory, liveSnapshot);

  // JSONL thinking and duplicate live thinking share messageKey → deduped
  // 2 JSONL + 1 (live tool_use, deduped thinking) = 3
  assert.equal(merged.length, 3, `Expected 3 after dedup, got ${merged.length}`);
  assert.equal(merged[0].type, 'user');
  assert.equal(merged[1].type, 'thinking'); // JSONL version preserved
  assert.equal(merged[2].type, 'tool_use'); // Live tool use
});

test('mergeAndDedupMessages does NOT drop non-duplicate messages with same type', () => {
  // Regression test: old code deduped all same-type JSONL messages because
  // fingerprint was only type + top-level content (both empty for JSONL).
  const user1 = { ...JSONL_USER, messageKey: 'pi:sess:line:1:msg:0' };
  const user2 = {
    ...JSONL_USER,
    messageKey: 'pi:sess:line:5:msg:0',
    message: { role: 'user', content: 'Another question entirely' },
  };
  const thinking1 = { ...JSONL_THINKING, messageKey: 'pi:sess:line:2:msg:0' };
  const thinking2 = {
    ...JSONL_THINKING,
    messageKey: 'pi:sess:line:6:msg:0',
    message: { role: 'assistant', content: 'Different thinking content' },
  };

  const jsonlHistory = [user1, thinking1, user2, thinking2];
  const liveSnapshot: any[] = [];

  const merged = mergeAndDedupMessages(jsonlHistory, liveSnapshot);

  assert.equal(merged.length, 4, 'All 4 distinct messages must survive (2 users + 2 thinkings)');
  assert.equal(merged[0].messageKey, user1.messageKey);
  assert.equal(merged[2].messageKey, user2.messageKey);
});

test('mergeAndDedupMessages deduplicates live messages within themselves (same messageKey)', () => {
  const duplicateLive = {
    type: 'assistant',
    content: 'same content',
    provider: 'pi',
    messageKey: 'pi:dup-key',
    isThinking: true,
  };

  const jsonlHistory: any[] = [JSONL_USER];
  const liveSnapshot = [duplicateLive, duplicateLive];

  const merged = mergeAndDedupMessages(jsonlHistory, liveSnapshot);

  // 1 JSONL + 1 live (deduped) = 2
  assert.equal(merged.length, 2, 'Duplicate live messages with same messageKey must be deduped');
});
