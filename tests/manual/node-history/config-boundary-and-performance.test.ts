/**
 * PURPOSE: Verify ozw keeps runtime transcript state out of conf.json while
 * preserving paginated history loading and transcript virtualization.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * PURPOSE: Read production source files from the working tree under test.
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

async function listProductionFiles(relativeRoot: string): Promise<string[]> {
  /**
   * PURPOSE: Collect production source files for static boundary checks without
   * including proposal archives or generated build output.
   */
  const root = path.join(REPO_ROOT, relativeRoot);
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'dist-node', '.git'].includes(entry.name)) continue;
        await walk(absolute);
      } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
        files.push(path.relative(REPO_ROOT, absolute));
      }
    }
  }
  await walk(root);
  return files;
}

test('production config code does not read or write project-local .ozw/conf.json', async () => {
  const sourceFiles = [
    ...(await listProductionFiles('server')),
    ...(await listProductionFiles('src')),
  ];
  const forbiddenIo = /\b(?:readFile|writeFile|mkdir|open)\s*\([^;\n]*(?:['"]\.ozw['"]|['"]\.ozw\/conf\.json['"])[^;\n]*conf\.json/;
  const offenders: string[] = [];

  for (const file of sourceFiles) {
    const source = await readRepoFile(file);
    if (forbiddenIo.test(source)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], `project-local .ozw/conf.json must not be a production config source: ${offenders.join(', ')}`);
});

test('conf.json no longer stores pending transcript or running request state', async () => {
  const serverIndex = await readRepoFile('backend/index.ts');
  const projects = await readRepoFile('backend/projects.ts');
  const combined = `${serverIndex}\n${projects}`;

  assert.doesNotMatch(
    combined,
    /\bpendingUserMessages\b|\bappendManualSessionPendingUserMessage\b/,
    'accepted user prompts must stay in native runtime/live transcript, not conf.json pendingUserMessages',
  );
  assert.doesNotMatch(
    combined,
    /\bpendingProviderSessionId\b|\bstartManualSessionDraft\b|\bstartRequestId\b|\bcancelRequested\b/,
    'running provider binding/cancel/request state must not be persisted to conf.json',
  );
});

test('history loading keeps pagination and transcript virtualization after live rendering is added', async () => {
  const sessionState = await readRepoFile('frontend/components/chat/hooks/useChatSessionState.ts');
  const pane = await readRepoFile('frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx');
  const virtualLimitMatch = pane.match(/MAX_RENDERED_TRANSCRIPT_MESSAGES\s*=\s*(\d+)/);

  assert.match(sessionState, /\blimit\b/, 'session message loading must still accept a limit');
  assert.match(sessionState, /\boffset\b/, 'session message loading must still support loading earlier pages by offset');
  assert.match(sessionState, /\bafterLine\b|\bafterCursor\b/, 'session message loading must keep an incremental cursor');
  assert.ok(virtualLimitMatch, 'ChatMessagesPane must keep a max rendered transcript message constant');
  assert.ok(
    Number(virtualLimitMatch[1]) <= 200,
    `virtualized render window should stay bounded, got ${virtualLimitMatch[1]}`,
  );
  assert.match(pane, /data-virtualized="true"/, 'chat transcript container must remain virtualized');
});
