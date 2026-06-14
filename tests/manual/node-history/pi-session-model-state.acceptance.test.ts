import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('project session model-state normalizes, applies, and persists Pi thinkingLevel', () => {
  const source = readRepoFile('backend/projects.ts');

  const normalizeIndex = source.indexOf('function normalizeSessionModelState');
  assert.notEqual(normalizeIndex, -1, 'projects.ts must define normalizeSessionModelState');
  const normalizeBlock = source.slice(normalizeIndex, normalizeIndex + 1200);
  assert.match(normalizeBlock, /thinkingLevel/, 'normalizeSessionModelState must preserve canonical thinkingLevel');
  assert.match(normalizeBlock, /thinkingMode/, 'normalizeSessionModelState must keep backward-compatible thinkingMode reads');

  const applyIndex = source.indexOf('function applySessionModelState');
  assert.notEqual(applyIndex, -1, 'projects.ts must define applySessionModelState');
  const applyBlock = source.slice(applyIndex, applyIndex + 900);
  assert.match(applyBlock, /thinkingLevel/, 'applySessionModelState must attach thinkingLevel to sessions returned to the frontend');

  const updateIndex = source.indexOf('async function updateSessionModelState');
  assert.notEqual(updateIndex, -1, 'projects.ts must define updateSessionModelState');
  const updateBlock = source.slice(updateIndex, updateIndex + 1800);
  assert.match(updateBlock, /patch\.thinkingLevel/, 'updateSessionModelState must accept patch.thinkingLevel');
  assert.match(updateBlock, /next\.thinkingLevel/, 'updateSessionModelState must persist next.thinkingLevel');
  assert.match(updateBlock, /record\.thinkingLevel/, 'updateSessionModelState must mirror thinkingLevel onto chat records');
});

test('model-state HTTP API accepts thinkingLevel in addition to Codex reasoningEffort', () => {
  const source = readRepoFile('backend/index.ts');
  const routeIndex = source.indexOf("app.put('/api/projects/:projectName/sessions/:sessionId/model-state'");
  assert.notEqual(routeIndex, -1, 'server must expose model-state PUT route');

  const routeBlock = source.slice(routeIndex, routeIndex + 1300);
  assert.match(routeBlock, /req\.body\?\.thinkingLevel/, 'model-state PUT must read req.body.thinkingLevel');
  assert.match(routeBlock, /req\.body\?\.reasoningEffort/, 'model-state PUT must keep Codex reasoningEffort support');
});

test('ChatInterface syncs Pi thinkingLevel from session model-state and broadcasts', () => {
  const source = readRepoFile('frontend/components/chat/view/ChatInterface.tsx');

  assert.match(source, /thinkingLevel/, 'ChatInterface must read thinkingLevel from session model-state messages');
  assert.match(source, /setPiThinkingLevel/, 'ChatInterface must update Pi thinking level state from persisted/broadcast state');
  assert.match(source, /messageProvider === 'pi'|effectiveProvider === 'pi'/, 'ChatInterface must handle Pi-specific model-state sync separately from Codex');
});
