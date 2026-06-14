/**
 * 60-优化Pi会话输入区icon和模型选择样式
 *
 * 契约测试 2：Pi 会话消息恢复（刷新后）
 * - 确保 handleGetSessionMessages 正确处理 Pi 会话的 provider
 * - 确保 session-messages-handler.ts 中 Pi cN 路由的 live/message 恢复路径完整
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

test('handleGetSessionMessages correctly passes provider for Pi cN route sessions', () => {
  const source = readRepoFile('backend/session-messages-handler.ts');

  // The handler must resolve cN provider from runtime context
  assert.match(source, /runtimeContext\?\.provider/, 'session-messages-handler must resolve provider from runtime context');
  assert.match(source, /getPiSessionMessages/, 'session-messages-handler must call getPiSessionMessages for Pi sessions');
});

test('findPiSessionFilePath covers Pi SDK file naming patterns', () => {
  const source = readRepoFile('backend/projects.ts');

  // findPiSessionFilePath must match by both filename segment and first-record id
  assert.match(source, /filenameMatch|includes.*sessionId|basename.*includes/, 'findPiSessionFilePath must match by filename');
  assert.match(source, /JSON\.parse|firstLine|firstRecord|record\.id/, 'findPiSessionFilePath must fallback to first-record id matching');
});

test('getPiSessionMessages returns messages from Pi JSONL for completed sessions', () => {
  const source = readRepoFile('backend/projects.ts');

  // getPiSessionMessages must call findPiSessionFilePath then readPiTranscriptByLineCursor
  assert.match(source, /findPiSessionFilePath/, 'getPiSessionMessages must call findPiSessionFilePath');
  assert.match(source, /readPiTranscriptByLineCursor/, 'getPiSessionMessages must call readPiTranscriptByLineCursor');
  // Must return messages and total count
  assert.match(source, /messages:\s*\[/, 'getPiSessionMessages must return messages array');
  assert.match(source, /\btotal\b/, 'getPiSessionMessages must return total count');
});

test('Pi runtime preserves live transcript for in-flight sessions', () => {
  const source = readRepoFile('backend/native-agent-runtime.ts');

  // Pi runtime must maintain liveMessages for active sessions
  assert.match(source, /liveMessages/, 'Pi runtime must maintain liveMessages for active sessions');
  // getNativeSessionLiveTranscript must check Pi sessions
  assert.match(source, /PiSessionRecord/, 'Pi runtime must have PiSessionRecord type');
  // The live transcript is exposed via getNativeSessionLiveTranscript
  assert.match(source, /getNativeSessionLiveTranscript/, 'native-agent-runtime must export getNativeSessionLiveTranscript');
});
