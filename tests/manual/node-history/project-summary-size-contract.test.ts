/**
 * PURPOSE: Keep the project overview read model small enough for first paint
 * by preventing unbounded session arrays from being returned through /api/projects.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const projectsSource = readFileSync('backend/projects.ts', 'utf8');
const workflowsSource = readFileSync('backend/workflows.ts', 'utf8');
const serverSource = readFileSync('backend/index.ts', 'utf8');
const apiSource = readFileSync('frontend/utils/api.ts', 'utf8');

test('project overview session limit is finite and intentionally small', () => {
  assert.doesNotMatch(
    projectsSource,
    /PROJECT_OVERVIEW_SESSION_LIMIT\s*=\s*Number\.MAX_SAFE_INTEGER/,
    'project overview must not expose an unlimited session list',
  );

  const limitMatch = projectsSource.match(/PROJECT_OVERVIEW_SESSION_LIMIT\s*=\s*(\d+)/);
  assert.ok(limitMatch, 'project overview must define a numeric finite session limit');
  assert.ok(
    Number(limitMatch[1]) > 0 && Number(limitMatch[1]) <= 50,
    `project overview session limit should be 1..50, got ${limitMatch[1]}`,
  );
});

test('client exposes a paginated project session API separate from project overview', () => {
  assert.match(
    apiSource,
    /projectSessions|loadMoreProjectSessions|sessions:\s*\([^)]*limit[^)]*offset/,
    'client API must provide a paginated session-list path instead of relying on full /api/projects payloads',
  );
});

test('project overview carries compact workflow summaries instead of detail payloads', () => {
  assert.match(
    workflowsSource,
    /summarizeWorkflowForProjectList/,
    'workflow module must expose a project-list summary mapper',
  );
  assert.doesNotMatch(
    workflowsSource,
    /summarizeWorkflowForProjectList[\s\S]{0,1400}(controlPlaneReadModel|stageInspections|artifacts|workflowDisplay|workflowRoleSummary)/,
    'project-list workflow summaries must not include detail-only workflow payload fields',
  );
  assert.match(
    workflowsSource,
    /listProjectWorkflows\(projectPath\)\)\.map\(summarizeWorkflowForProjectList\)/,
    '/api/projects attachWorkflowMetadata must return compact workflow summaries',
  );
});

test('single-project workflow list does not rebuild the global project list', () => {
  const workflowListRoute = serverSource.match(
    /app\.get\('\/api\/projects\/:projectName\/workflows'[\s\S]*?\n\t?}\);/,
  )?.[0] || '';
  assert.ok(workflowListRoute, 'server must define the project workflow list route');
  assert.doesNotMatch(
    workflowListRoute,
    /getProjects\(/,
    'workflow list route must resolve only the requested project instead of rebuilding all projects',
  );
  assert.match(
    workflowListRoute,
    /listProjectWorkflows\(projectPath\)/,
    'workflow list route must read workflows directly from the requested project path',
  );
});

test('session visibility does not stat the owning project once per session', () => {
  assert.match(
    projectsSource,
    /normalizeComparablePath\(sessionProjectPath\)\s*===\s*normalizeComparablePath\(fallbackProjectPath\)/,
    'session visibility should trust the already-resolved owning project path for first-paint session summaries',
  );
});

test('project discovery snapshot cache is used for repeated first-paint requests', () => {
  assert.match(
    projectsSource,
    /projectsSnapshotCache[\s\S]{0,500}expiresAt/,
    'getProjects should reuse the existing project snapshot cache within PROJECTS_CACHE_TTL_MS',
  );
  assert.match(
    projectsSource,
    /cloneProjectsSnapshot/,
    'cached project snapshots must be cloned before returning to callers',
  );
});

test('project discovery does not reread Codex JSONL headers for titled sessions', () => {
  assert.match(
    projectsSource,
    /titledSessionIds/,
    'Codex route title hydration should track sessions that already have persisted titles',
  );
  assert.match(
    projectsSource,
    /titledSessionIds\.has\(session\.id\)/,
    'Codex route title hydration must skip JSONL reads when conf already stores a route title',
  );
});

test('project overview limits recovered Pi cN records before route indexing', () => {
  assert.match(
    projectsSource,
    /persistedCNPiEntries\.slice\(0,\s*limit\)/,
    'Pi cN recovery must be bounded for overview requests before route indexing',
  );
});

test('session route indexing uses a lookup map instead of scanning chat records per session', () => {
  assert.match(
    projectsSource,
    /existingRouteBySessionId\s*=\s*new Map/,
    'route indexing should build a sessionId lookup once for large conf.json files',
  );
  assert.doesNotMatch(
    projectsSource,
    /Object\.entries\(config\.chat\)\.find\(\(\[, record\]\) => record\?\.sessionId === session\.id\)/,
    'route indexing must not scan every chat record for every visible session',
  );
});
