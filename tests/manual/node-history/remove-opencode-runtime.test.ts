/**
 * PURPOSE: Guard the runtime boundary after OpenCode support is removed.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'path';
import { test } from 'node:test';

const repoRoot = process.cwd();

async function readRuntimeFile(relativePath: string): Promise<string> {
  /**
   * Read a runtime source file from the repository root for static contracts.
   */
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('server runtime no longer exposes OpenCode routes, SDK, websocket commands, or provider whitelist', async () => {
  assert.equal(existsSync(path.join(repoRoot, 'backend/routes/opencode.ts')), false);
  assert.equal(existsSync(path.join(repoRoot, 'backend/opencode-sdk.ts')), false);

  const serverIndex = await readRuntimeFile('backend/index.ts');
  assert.equal(serverIndex.includes('/api/cli/opencode'), false);
  assert.equal(serverIndex.includes('opencode-command'), false);

  // The co protocol client has been removed entirely; only codex/pi remain.
  assert.equal(existsSync(path.join(repoRoot, 'backend/co-client.ts')), false);
});

test('project and frontend runtime sources do not carry OpenCode provider fields', async () => {
  const runtimeFiles = [
    'backend/projects.ts',
    'backend/session-messages-handler.ts',
    'frontend/types/app.ts',
    'frontend/hooks/useProjectsState.ts',
    'frontend/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx',
    'frontend/components/settings/constants/constants.ts',
  ];

  for (const relativePath of runtimeFiles) {
    const source = await readRuntimeFile(relativePath);
    assert.equal(source.includes('opencode'), false, `${relativePath} must not reference opencode`);
    assert.equal(source.includes('OpenCode'), false, `${relativePath} must not reference OpenCode`);
  }
});
