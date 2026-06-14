/**
 * PURPOSE: Lock the session page request stability contract so idle chat pages
 * do not repeatedly fetch the same message, command, model, and token endpoints.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

/**
 * Read a repository source file as UTF-8 text.
 */
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Extract the dependency array around a nearby marker.
 */
function dependencyBlockAfter(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing marker ${marker}`);
  const tail = source.slice(markerIndex);
  const match = tail.match(/\},\s*\[([\s\S]*?)\]\);/);
  assert.ok(match, `missing dependency block after ${marker}`);
  return match[1];
}

test('slash command loading depends on a stable project key, not the project object', () => {
  const source = readSource('frontend/components/chat/hooks/useSlashCommands.ts');
  const dependencyBlock = dependencyBlockAfter(source, 'fetchCommands();');

  assert.doesNotMatch(
    dependencyBlock,
    /\bselectedProject\b/,
    'slash command fetch effect must not depend on the full selectedProject object',
  );
});

test('token usage loading depends on stable session identity, not whole objects', () => {
  const source = readSource('frontend/components/chat/hooks/useChatSessionState.ts');
  const dependencyBlock = dependencyBlockAfter(source, 'fetchInitialTokenUsage();');

  assert.doesNotMatch(
    dependencyBlock,
    /\bselectedProject\b(?!\?\.name|\?\.path|\?\.fullPath)/,
    'token usage effect must use project/session/provider keys instead of the whole selectedProject object',
  );
});

test('session status reconcile timer is not recreated by input or focus changes', () => {
  const source = readSource('frontend/components/chat/view/ChatInterface.tsx');
  const dependencyBlock = dependencyBlockAfter(source, 'SESSION_STATUS_RECONCILE_INTERVAL_MS');

  assert.doesNotMatch(dependencyBlock, /\binput\b/, 'typing must not recreate status reconcile polling');
  assert.doesNotMatch(
    dependencyBlock,
    /\bisInputFocused\b/,
    'focus changes must not recreate status reconcile polling',
  );
});
