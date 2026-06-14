/**
 * PURPOSE: Lock the command-tool card structure so Codex and Pi show commands
 * directly and fold output without nesting it under a second tool-name group.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Read a repository file using a path relative to the repository root.
 */
function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/**
 * Extract a top-level tool config block with enough context for source contracts.
 */
function extractToolConfigBlock(source: string, toolName: string): string {
  const escapedToolName = toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(`(?:^|\\n)\\s*(?:['"]${escapedToolName}['"]|${escapedToolName}):\\s*\\{`, 'm');
  const startMatch = source.match(startPattern);
  if (!startMatch || startMatch.index === undefined) {
    return '';
  }

  const startIndex = startMatch.index;
  const rest = source.slice(startIndex + startMatch[0].length);
  const nextTopLevelConfig = rest.search(/\n\s{2}(?:['"][^'"]+['"]|[A-Za-z][A-Za-z0-9_]*):\s*\{/);
  return nextTopLevelConfig >= 0
    ? source.slice(startIndex, startIndex + startMatch[0].length + nextTopLevelConfig)
    : source.slice(startIndex);
}

test('command tool input renderers receive toolResult for in-card folded output', () => {
  const source = readRepoFile('frontend/components/chat/tools/configs/toolConfigs.ts');

  for (const toolName of ['Bash', 'exec_command', 'functions.exec_command']) {
    const block = extractToolConfigBlock(source, toolName);
    assert.ok(block, `${toolName} config must exist`);
    assert.match(
      block,
      /getContentProps:\s*\(\s*input\s*,\s*(helpers|context)/,
      `${toolName} input renderer must receive ToolRenderer helpers`,
    );
    assert.match(
      block,
      /getShellCommandPayload\(\s*input\s*,\s*(helpers|context)\??\.toolResult\s*\)/,
      `${toolName} must pass helpers.toolResult into getShellCommandPayload`,
    );
  }
});

test('command tools do not render a second independent Output result group', () => {
  const source = readRepoFile('frontend/components/chat/tools/configs/toolConfigs.ts');

  for (const toolName of ['Bash', 'exec_command', 'functions.exec_command']) {
    const block = extractToolConfigBlock(source, toolName);
    assert.ok(block, `${toolName} config must exist`);
    assert.match(
      block,
      /result:\s*\{[\s\S]{0,160}hidden:\s*true/,
      `${toolName} result must be hidden after output is folded into the command card`,
    );
    assert.doesNotMatch(
      block,
      /result:\s*\{[\s\S]{0,180}type:\s*['"]collapsible['"]/,
      `${toolName} must not create a second collapsible result group`,
    );
  }
});

test('file operation tools show concrete operation names and support Pi path payloads', () => {
  const source = readRepoFile('frontend/components/chat/tools/configs/toolConfigs.ts');
  const readBlock = extractToolConfigBlock(source, 'Read');

  assert.ok(readBlock, 'Read config must exist');
  assert.match(
    readBlock,
    /label:\s*['"]Read['"]/,
    'Read input row must show the operation name instead of only a path/output body',
  );
  assert.match(
    source,
    /function\s+getFileOperationPath[\s\S]*input\?\.file_path\s*\|\|\s*input\?\.path/,
    'file operation path resolver must support both Codex file_path and Pi path payloads',
  );
  assert.match(
    readBlock,
    /hideOnSuccess:\s*true/,
    'Read success output must stay hidden because the linked file row already explains the operation',
  );

  for (const [toolName, displayName] of [
    ['Edit', 'Edit'],
    ['Edit file', 'Edit'],
    ['Write', 'Write'],
    ['ApplyPatch', 'Patch'],
  ]) {
    const block = extractToolConfigBlock(source, toolName);
    assert.ok(block, `${toolName} config must exist`);
    assert.match(
      block,
      new RegExp(`displayToolName:\\s*['"]${displayName}['"]`),
      `${toolName} summary must show the concrete operation instead of a generic File label`,
    );
    assert.match(
      block,
      /title:\s*\(input\)\s*=>\s*getFileOperationPath\(input\)\s*\|\|\s*['"]file['"]/,
      `${toolName} summary title must use the linked file path`,
    );
  }
  assert.match(
    extractToolConfigBlock(source, 'Write'),
    /badge:\s*['"]Write['"]/,
    'Write diff badge must show Write rather than a generic New label',
  );
});

test('tool card has no outer title bar; tool name rendered by ToolRenderer (#64)', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // 64 号提案移除了 codex-tool-card-title 外层标题。
  // 工具名现在由 ToolRenderer 负责展示，不再由 MessageComponent 渲染标题栏。
  assert.doesNotMatch(
    source,
    /data-testid="codex-tool-card-title"/,
    '工具卡片不应再包含外层工具名标题（64 号提案已移除）',
  );
  assert.doesNotMatch(
    source,
    /\{message\.toolName\s*\|\|\s*['"]Tool['"]\}/,
    'MessageComponent 不应再展示外层工具名标题',
  );
});

test('collapsible tool cards use card chrome instead of thinking-block-only chrome', () => {
  const source = readRepoFile('frontend/components/chat/tools/components/CollapsibleDisplay.tsx');

  assert.match(
    source,
    /rounded\s+border\s+border-gray-200\/70/,
    'collapsible tools must render as bordered cards aligned with Codex command cards',
  );
  assert.match(
    source,
    /border-l-2\s+\$\{borderColor\}/,
    'collapsible tools may keep the category accent but must not rely on it as the only chrome',
  );
});
