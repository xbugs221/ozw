/**
 * PURPOSE: Lock the chat message chrome contract so live thinking and tool
 * cards do not show redundant block titles above their real content.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

/**
 * Read a source file from the repository root used by the test runner.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('tool cards do not render a redundant MessageComponent title row', async () => {
  const source = await readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  assert.doesNotMatch(
    source,
    /data-testid="codex-tool-card-title"/,
    'MessageComponent must not render a separate provider-specific tool title row above ToolRenderer content',
  );
  assert.doesNotMatch(
    source,
    /\{message\.toolName\s*\|\|\s*['"]Tool['"]\}/,
    'MessageComponent must not render the tool name as a redundant outer block title',
  );
});

test('thinking messages do not render the 思考中 block title', async () => {
  const source = await readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  assert.doesNotMatch(
    source,
    /t\(['"]thinking\.emoji['"]\)/,
    'thinking content should be visible without a separate 思考中 summary/title label',
  );
});
