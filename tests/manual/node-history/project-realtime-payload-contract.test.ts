/**
 * PURPOSE: Lock the performance contract that provider file changes must not
 * broadcast full project snapshots to every browser websocket client.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverIndexSource = readFileSync('backend/index.ts', 'utf8');
const projectsStateSource = readFileSync('frontend/hooks/useProjectsState.ts', 'utf8');

test('provider watcher realtime updates do not broadcast full projects snapshots', () => {
  const broadcastMatch = serverIndexSource.match(
    /async function broadcastProjectsUpdated[\s\S]*?const updateMessage = JSON\.stringify\(\{([\s\S]*?)\}\);/,
  );

  assert.ok(broadcastMatch, 'backend/index.ts must expose the project update broadcast implementation');

  const payloadShape = broadcastMatch[1];
  assert.doesNotMatch(
    payloadShape,
    /\bprojects\s*:\s*updatedProjects\b/,
    'high-frequency project update broadcasts must not include the full projects array',
  );
});

test('frontend can consume invalidation or scoped session updates without requiring projects_updated.projects', () => {
  assert.match(
    projectsStateSource,
    /session_changed|project_list_invalidated|workflow_changed|project_invalidated/,
    'useProjectsState must consume scoped invalidation/update events instead of only full projects_updated payloads',
  );

  assert.doesNotMatch(
    projectsStateSource,
    /latestMessage\.type !== 'projects_updated'[\s\S]{0,400}latestMessage\.projects/,
    'frontend project state should not require full projects_updated.projects for ordinary realtime refresh',
  );
});
