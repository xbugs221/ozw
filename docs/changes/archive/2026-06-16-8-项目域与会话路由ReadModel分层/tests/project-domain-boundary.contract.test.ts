/**
 * PURPOSE: Contract test for proposal 8. It audits the real source tree so the
 * project domain cannot keep growing inside backend/projects.ts after the
 * refactor is complete.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * Read a repository file as UTF-8 text.
 *
 * @param relativePath Path relative to the repository root.
 * @returns File contents.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Count source-level function declarations that still live in a file.
 *
 * @param source TypeScript or JavaScript source text.
 * @returns Number of function declarations.
 */
function countFunctionDeclarations(source: string): number {
  return (source.match(/\n(?:async\s+)?function\s+[A-Za-z0-9_]+/g) || []).length;
}

test('project domain modules exist with business entry points', async () => {
  const expectedModules = [
    'backend/domains/projects/project-discovery-read-model.ts',
    'backend/domains/projects/project-config-read-model.ts',
    'backend/domains/projects/manual-session-route-read-model.ts',
    'backend/domains/projects/project-overview-service.ts',
    'backend/domains/projects/project-session-delete-service.ts',
    'backend/domains/projects/chat-history-search-service.ts',
  ];

  for (const modulePath of expectedModules) {
    const absolutePath = path.join(REPO_ROOT, modulePath);
    assert.equal(existsSync(absolutePath), true, `${modulePath} must exist after the project-domain split`);
    const source = await readRepoFile(modulePath);
    assert.match(source, /PURPOSE|目的|职责|ReadModel|Service/i, `${modulePath} must explain its business purpose`);
    assert.match(source, /export\s+(async\s+)?function|export\s+const/, `${modulePath} must expose a tested business entry`);
  }
});

test('backend/projects.ts becomes a compatibility facade instead of the rule owner', async () => {
  const source = await readRepoFile('backend/projects.ts');
  const lineCount = source.split(/\r?\n/).length;
  const functionCount = countFunctionDeclarations(source);
  const forbiddenClusters = [
    'buildCodexProviderSessionsReadModel',
    'buildPiProviderSessionsReadModel',
    'searchChatHistory',
    'deleteCodexSession',
    'getNextManualSessionRouteIndex',
    'attachSessionRouteIndices',
  ];
  const stillOwnedClusters = forbiddenClusters.filter((name) => source.includes(`function ${name}`) || source.includes(`async function ${name}`));

  assert.ok(lineCount <= 1800, `backend/projects.ts should be a facade; current line count is ${lineCount}`);
  assert.ok(functionCount <= 35, `backend/projects.ts should delegate most rules; current function count is ${functionCount}`);
  assert.deepEqual(stillOwnedClusters, [], `backend/projects.ts still owns project-domain clusters: ${stillOwnedClusters.join(', ')}`);
});

test('project list summary spec keeps the lightweight API contract visible', async () => {
  const spec = await readRepoFile('docs/specs/project-list-summary-api.md');
  for (const forbiddenField of ['sessions', 'codexSessions', 'piSessions', 'workflows', 'batches']) {
    assert.match(spec, new RegExp(forbiddenField), `project-list summary spec must explicitly guard ${forbiddenField}`);
  }
  assert.match(spec, /overview/, 'project overview must remain the on-demand detail entry');
  assert.match(spec, /buildProviderSessionListReadModel/, 'provider session filtering must remain tied to the read model');
});
