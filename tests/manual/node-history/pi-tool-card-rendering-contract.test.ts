/**
 * 60-优化Pi会话输入区icon和模型选择样式
 *
 * 契约测试 3：Pi 工具调用获得 Codex 风格卡片渲染
 * - MessageComponent 中 isCodexToolCard 不再排他，Pi 工具也获得卡片
 * - ToolRenderer 和 getToolConfig 支持大小写不敏感工具名
 * - getToolCategory 兼容小写工具名
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

test('MessageComponent tool card condition does not exclude Pi provider', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // The isCodexToolCard must NOT filter by provider
  const hasOldDiscriminatoryCheck = /isCodexToolCard\s*=\s*messageProvider\s*===\s*['"]codex['"]/.test(source);
  assert.ok(!hasOldDiscriminatoryCheck, 'tool card condition must not hard-filter on provider === codex');
});

test('ToolRenderer supports case-insensitive tool name lookup', () => {
  const source = readRepoFile('frontend/components/chat/tools/ToolRenderer.tsx');

  // Must normalize toolName before getToolConfig lookup
  const hasNormalization = /toolName\s*(\.toLowerCase|\.toUpperCase|\.charAt\(0\)\.toUpperCase|\.replace|normalize)/.test(source)
    || /getToolConfig\([^)]*(toLowerCase|toUpperCase)/.test(source)
    || /getToolConfig\b[\s\S]{0,50}\.toLowerCase/.test(source)
    || /getToolConfig\b[\s\S]{0,50}\.toUpperCase/.test(source);
  assert.ok(hasNormalization, 'ToolRenderer must normalize toolName case before getToolConfig lookup');
});

test('getToolCategory recognizes lowercase tool names from Pi SDK', () => {
  const source = readRepoFile('frontend/components/chat/tools/ToolRenderer.tsx');

  // getToolCategory must handle lowercase variants
  const hasLowercaseHandling = /\bbash\b/.test(source)
    || /\b.toLowerCase\(\)/.test(source);
  // Either the function handles lower case explicitly, or the toolName is normalized before calling it
  assert.ok(hasLowercaseHandling, 'getToolCategory must handle lowercase tool names like "bash"');
});

test('Running tool detection works for both Pi and Codex', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // Must detect running tools using both exitCode (Codex) and status (Pi)
  const hasPiRunningDetection = /status\s*===\s*['"]running['"]/.test(source)
    || /message\.status\s*===/.test(source);
  assert.ok(hasPiRunningDetection, 'tool running detection must include status === running for Pi');
});
