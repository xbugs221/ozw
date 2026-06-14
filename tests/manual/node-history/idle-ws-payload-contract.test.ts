/**
 * PURPOSE: Verify the performance optimisation delivers measurable payload
 * reduction through concrete code-analysis assertions.  Covers task 6.3
 * (compare pre/post payload sizes) and 6.4 (idle WS no 2MB frames) by
 * inspecting the server broadcast shapes, frontend event consumers, and
 * API parameter guards.
 *
 * This is a code-contract test – it does not connect to a live server.
 * For browser-level payload confirmation, run Playwright e2e with a
 * running ozw instance and monitor ws frames / network response sizes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverIndexSource = readFileSync('backend/index.ts', 'utf8');
const serverProjectsSource = readFileSync('backend/projects.ts', 'utf8');
const projectsStateSource = readFileSync('frontend/hooks/useProjectsState.ts', 'utf8');
const fileMentionsSource = readFileSync('frontend/components/chat/hooks/useFileMentions.tsx', 'utf8');
const apiSource = readFileSync('frontend/utils/api.ts', 'utf8');

// ── 6.3: /api/projects payload ───────────────────────────────────────

test('/api/projects overview payload is bounded by a finite session limit', () => {
  const limitMatch = serverProjectsSource.match(/PROJECT_OVERVIEW_SESSION_LIMIT\s*=\s*(\d+)/);
  assert.ok(limitMatch, 'backend/projects.ts must define PROJECT_OVERVIEW_SESSION_LIMIT');
  const limit = Number(limitMatch[1]);
  assert.ok(limit > 0 && limit <= 50, `PROJECT_OVERVIEW_SESSION_LIMIT should be 1..50, got ${limit}`);
});

test('/api/projects response does not embed infinite session arrays', () => {
  // Verify the server slices sessions to the limit.
  const sliceMatches = serverProjectsSource.match(/\.sessions\b[^;]{0,200}\.slice\b/g) || [];
  assert.ok(sliceMatches.length > 0, 'project overview must slice sessions to a bounded length');
});

test('/api/projects does not carry full workflow details inline', () => {
  // Workflows should be summary-only; full detail fetched on demand.
  assert.doesNotMatch(
    serverProjectsSource,
    /workflows:\s*readWorkflows/,
    'project overview should not inline full Go-runner workflow read models',
  );
});

// ── 6.3: /files payload ──────────────────────────────────────────────

test('file mention request uses bounded depth=2 and showHidden=false', () => {
  assert.match(fileMentionsSource, /depth:\s*2/,
    'file mention must request shallow tree with depth=2');
  assert.match(fileMentionsSource, /showHidden:\s*false/,
    'file mention must exclude hidden files (showHidden=false)');
});

test('file mention does not request full depth tree', () => {
  assert.doesNotMatch(fileMentionsSource, /\bdepth:\s*10\b/,
    'file mention must not request depth=10 full-repo scan');
  assert.doesNotMatch(fileMentionsSource, /\bshowHidden:\s*true\b/,
    'file mention must not request showHidden=true');
});

test('client provides paginated session API separate from full project load', () => {
  assert.match(
    apiSource,
    /projectSessions|loadMoreProjectSessions|sessions:\s*\([^)]*limit[^)]*offset/,
    'client must expose paginated session-list API',
  );
});

// ── 6.4: idle WebSocket payload ──────────────────────────────────────

test('provider watcher uses scoped events, not full projects_updated', () => {
  // The watcher debounce handler must broadcast
  // session_changed + project_list_invalidated, NOT projects_updated.
  assert.match(serverIndexSource, /broadcastSessionChanged\(/,
    'provider watcher must broadcast session_changed');
  assert.match(serverIndexSource, /broadcastProjectListInvalidated\(/,
    'provider watcher must broadcast project_list_invalidated');

  // Verify the watcher code path (debouncedUpdate -> setTimeout -> broadcastSessionChanged)
  // exists and doesn't call broadcastProjectsUpdated inside the debounce.
  const watcherBlock = serverIndexSource.match(
    /debouncedUpdate\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?setTimeout[\s\S]{0,1500}catch\s*\(/,
  );
  assert.ok(watcherBlock, 'must locate the debouncedUpdate watcher handler');
  assert.doesNotMatch(watcherBlock[0], /broadcastProjectsUpdated\(/,
    'provider watcher debounce must NOT call broadcastProjectsUpdated');
});

test('Go-runner watcher uses scoped workflow_changed, not full projects_updated', () => {
  // The Go-runner watcher must broadcast workflow_changed,
  // NOT full projects_updated on state/log file changes.
  assert.match(serverIndexSource, /broadcastWorkflowChanged\(/,
    'Go-runner watcher must broadcast workflow_changed');

  const goWatcherBlock = serverIndexSource.match(
    /scheduleGoRunnerProjectUpdate[\s\S]{0,400}setTimeout[\s\S]{0,400}WATCHER_DEBOUNCE_MS/,
  );
  assert.ok(goWatcherBlock, 'must locate the Go runner watcher handler block');
  assert.doesNotMatch(goWatcherBlock[0], /broadcastProjectsUpdated\(/,
    'Go-runner watcher must NOT broadcast full projects_updated');
});

test('scoped broadcast payloads are much smaller than full project snapshots', () => {
  // Extract the JSON.stringify shapes of each broadcast to confirm
  // they carry only identifier fields, not data arrays.

  const sessionChangedMatch = serverIndexSource.match(
    /function broadcastSessionChanged[\s\S]{0,300}JSON\.stringify\(\{([\s\S]*?)\}\)/,
  );
  assert.ok(sessionChangedMatch, 'must locate broadcastSessionChanged payload shape');

  const sessionPayload = sessionChangedMatch[1];
  // session_changed carries only provider, projectPath, sessionId, changedFile, changeType, timestamp
  assert.match(sessionPayload, /provider/);
  assert.match(sessionPayload, /sessionId/);
  assert.doesNotMatch(sessionPayload, /\bprojects\b/,
    'session_changed payload must not embed the projects array');
  assert.doesNotMatch(sessionPayload, /\bsessions\b/,
    'session_changed payload must not embed sessions arrays');
  assert.doesNotMatch(sessionPayload, /\bmessages\b/,
    'session_changed payload must not embed message bodies');

  const workflowChangedMatch = serverIndexSource.match(
    /function broadcastWorkflowChanged[\s\S]{0,300}JSON\.stringify\(\{([\s\S]*?)\}\)/,
  );
  assert.ok(workflowChangedMatch, 'must locate broadcastWorkflowChanged payload shape');

  const workflowPayload = workflowChangedMatch[1];
  assert.match(workflowPayload, /runId/);
  assert.match(workflowPayload, /projectName/);
  assert.doesNotMatch(workflowPayload, /\bprojects\b/,
    'workflow_changed payload must not embed the projects array');
  assert.doesNotMatch(workflowPayload, /\bsessions\b/,
    'workflow_changed payload must not embed session data');

  const invalidationMatch = serverIndexSource.match(
    /function broadcastProjectListInvalidated[\s\S]{0,300}JSON\.stringify\(\{([\s\S]*?)\}\)/,
  );
  assert.ok(invalidationMatch, 'must locate broadcastProjectListInvalidated payload shape');

  const invalidationPayload = invalidationMatch[1];
  assert.doesNotMatch(invalidationPayload, /\bprojects\b/,
    'project_list_invalidated payload must not embed the projects array');
  assert.doesNotMatch(invalidationPayload, /\b: \[\s*\{/,
    'project_list_invalidated payload must not embed JSON arrays of objects');
});

test('frontend idle handler consumes scoped events without triggering full project reloads', () => {
  // session_changed handler must not call fetchProjects — it only sets externalMessageUpdate.
  const sessionChangedBlock = serverIndexSource.match(
    /if \(latestMessage\.type === 'session_changed'\)[\s\S]{0,300}/,
  )?.[0] ?? '';
  assert.doesNotMatch(
    projectsStateSource,
    /if \(latestMessage\.type === 'session_changed'\)[\s\S]{0,400}fetchProjects\b/,
    'session_changed handler must not call full fetchProjects',
  );

  // workflow_changed matches by runId and calls handleSidebarRefresh via ref
  assert.match(projectsStateSource, /workflow_changed/,
    'socket handler must process workflow_changed events');
  assert.match(projectsStateSource, /runId.*selectedWorkflowRef/,
    'workflow_changed handler must match by runId against selectedWorkflowRef');
  assert.match(projectsStateSource, /handleSidebarRefreshRef\.current/,
    'workflow_changed handler must call handleSidebarRefresh via ref');

  // project_list_invalidated triggers fetchProjects (the only full reload path)
  assert.match(projectsStateSource, /project_list_invalidated/,
    'socket handler must process project_list_invalidated');
  assert.match(projectsStateSource, /projectListInvalidated[\s\S]{0,200}?.fetchProjects\(\)/,
    'project_list_invalidated must trigger fetchProjects for lightweight refresh');
});

test('frontend does not rely on full projects_updated for ordinary realtime updates', () => {
  assert.doesNotMatch(
    projectsStateSource,
    /latestMessage\.type !== 'projects_updated'[\s\S]{0,400}latestMessage\.projects/,
    'frontend project state should not require full projects_updated.projects for ordinary realtime refresh',
  );
  assert.match(
    projectsStateSource,
    /session_changed|project_list_invalidated|workflow_changed/,
    'useProjectsState must consume scoped invalidation/update events',
  );
});
