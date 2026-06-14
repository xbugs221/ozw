// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify ordered realtime message helpers used by frontend consumers.
 * These tests cover backlog skipping and sequential project-state reduction.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  getMessageHistoryTailSequence,
  getPendingSocketMessages,
  sessionChangedMatchesSelectedSession,
  reduceProjectsUpdatedMessages,
} from '../../shared/socket-message-utils';

/**
 * Build a minimal project session for project-state reduction tests.
 *
 * @param {string} id
 * @param {string} updatedAt
 * @returns {{id: string, updated_at: string}}
 */
function createSession(id, updatedAt) {
  return {
    id,
    updated_at: updatedAt,
  };
}

/**
 * Build a minimal project descriptor for project-state reduction tests.
 *
 * @param {string} name
 * @param {Array<Record<string, any>>} sessions
 * @returns {{name: string, displayName: string, fullPath: string, sessions: Array<Record<string, any>>, codexSessions: Array}}
 */
function createProject(name, sessions) {
  return {
    name,
    displayName: name,
    fullPath: `/tmp/${name}`,
    sessions,
    codexSessions: [],
  };
}

test('getMessageHistoryTailSequence returns zero for empty history and latest sequence otherwise', () => {
  assert.equal(getMessageHistoryTailSequence([]), 0);
  assert.equal(
    getMessageHistoryTailSequence([
      { sequence: 4, message: {} },
      { sequence: 9, message: {} },
    ]),
    9,
  );
});

test('getPendingSocketMessages only returns entries newer than the processed cursor', () => {
  const history = [
    { sequence: 10, message: { type: 'old' } },
    { sequence: 11, message: { type: 'keep-1' } },
    { sequence: 12, message: { type: 'keep-2' } },
  ];

  assert.deepEqual(getPendingSocketMessages(history, 10), history.slice(1));
  assert.deepEqual(getPendingSocketMessages(history, 12), []);
});

test('reduceProjectsUpdatedMessages uses evolving snapshots for batched project updates', () => {
  const selectedSession = createSession('session-1', '2026-03-16T10:00:00.000Z');
  const initialProject = createProject('alpha', [selectedSession]);
  const firstUpdate = createProject('alpha', [createSession('session-1', '2026-03-16T10:00:00.000Z')]);
  const secondUpdate = createProject('alpha', [createSession('session-1', '2026-03-16T10:05:00.000Z')]);

  const result = reduceProjectsUpdatedMessages({
    messages: [
      {
        type: 'projects_updated',
        projects: [firstUpdate],
      },
      {
        type: 'projects_updated',
        projects: [secondUpdate],
      },
    ],
    projects: [initialProject],
    selectedProject: initialProject,
    selectedSession,
    activeSessions: new Set(),
    getProjectSessions: (project) => [...(project.sessions || []), ...(project.codexSessions || [])],
    isUpdateAdditive: (_currentProjects, _updatedProjects, _selectedProject, currentSelectedSession) =>
      currentSelectedSession?.updated_at !== '2026-03-16T10:05:00.000Z',
  });

  assert.equal(result.projects[0].sessions[0].updated_at, '2026-03-16T10:05:00.000Z');
  assert.equal(result.selectedProject?.name, 'alpha');
  assert.equal(result.selectedSession?.updated_at, '2026-03-16T10:05:00.000Z');
});

test('reduceProjectsUpdatedMessages counts external updates for inactive selected sessions', () => {
  const selectedSession = createSession('session-1', '2026-03-16T10:00:00.000Z');
  const selectedProject = createProject('alpha', [selectedSession]);

  const result = reduceProjectsUpdatedMessages({
    messages: [
      {
        type: 'projects_updated',
        changedFile: '/tmp/session-1.jsonl',
        projects: [selectedProject],
      },
    ],
    projects: [selectedProject],
    selectedProject,
    selectedSession,
    activeSessions: new Set(),
    getProjectSessions: (project) => [...(project.sessions || []), ...(project.codexSessions || [])],
    isUpdateAdditive: () => true,
  });

  assert.equal(result.externalMessageUpdateCount, 1);
});

test('reduceProjectsUpdatedMessages preserves selected workflow child when sidebar sessions refresh', () => {
  const selectedSession = {
    ...createSession('workflow-child-real-session', '2026-03-16T10:00:00.000Z'),
    workflowId: 'w1',
    routeIndex: 1,
  };
  const selectedProject = {
    ...createProject('alpha', []),
    workflows: [
      {
        id: 'w1',
        childSessions: [selectedSession],
      },
    ],
  };
  const refreshedProject = {
    ...createProject('alpha', [
      createSession('manual-session-updated-elsewhere', '2026-03-16T10:05:00.000Z'),
    ]),
    workflows: selectedProject.workflows,
  };

  const result = reduceProjectsUpdatedMessages({
    messages: [
      {
        type: 'projects_updated',
        changedFile: '/tmp/manual-session-updated-elsewhere.jsonl',
        projects: [refreshedProject],
      },
    ],
    projects: [selectedProject],
    selectedProject,
    selectedSession,
    activeSessions: new Set(),
    getProjectSessions: (project) => [...(project.sessions || []), ...(project.codexSessions || [])],
    isUpdateAdditive: () => true,
  });

  assert.equal(result.selectedProject?.name, 'alpha');
  assert.equal(result.selectedSession?.id, 'workflow-child-real-session');
  assert.equal(result.externalMessageUpdateCount, 0);
});

test('reduceProjectsUpdatedMessages preserves selected chat when unrelated project refresh omits it', () => {
  const selectedSession = createSession('session-open', '2026-03-16T10:00:00.000Z');
  const backgroundSession = createSession('session-background', '2026-03-16T10:05:00.000Z');
  const selectedProject = createProject('alpha', [selectedSession]);
  const paginatedRefresh = createProject('alpha', [backgroundSession]);

  const result = reduceProjectsUpdatedMessages({
    messages: [
      {
        type: 'projects_updated',
        changedFile: '/tmp/session-background.jsonl',
        projects: [paginatedRefresh],
      },
    ],
    projects: [selectedProject],
    selectedProject,
    selectedSession,
    activeSessions: new Set(),
    getProjectSessions: (project) => [...(project.sessions || []), ...(project.codexSessions || [])],
    isUpdateAdditive: () => true,
  });

  assert.equal(result.selectedProject?.name, 'alpha');
  assert.equal(result.selectedSession?.id, 'session-open');
  assert.equal(result.externalMessageUpdateCount, 0);
});

test('session_changed matches selected cN and provider-backed sessions', () => {
  assert.equal(
    sessionChangedMatchesSelectedSession(
      {
        type: 'session_changed',
        sessionId: 'c638',
        providerSessionId: '019e57c6-59bd-7c50-ae86-f92a5ddf624a',
      },
      {
        id: 'c638',
        providerSessionId: '019e57c6-59bd-7c50-ae86-f92a5ddf624a',
      },
    ),
    true,
    'cN route events should refresh the currently open manual session',
  );

  assert.equal(
    sessionChangedMatchesSelectedSession(
      {
        type: 'session_changed',
        sessionId: 'rollout-2026-05-24T10-17-57-019e57c6-59bd-7c50-ae86-f92a5ddf624a',
        providerSessionId: '019e57c6-59bd-7c50-ae86-f92a5ddf624a',
      },
      {
        id: 'rollout-2026-05-24T10-17-57-019e57c6-59bd-7c50-ae86-f92a5ddf624a',
        sourceSessionId: '019e57c6-59bd-7c50-ae86-f92a5ddf624a',
      },
    ),
    true,
    'native Codex route events should match either the route id or provider id',
  );

  assert.equal(
    sessionChangedMatchesSelectedSession(
      {
        type: 'session_changed',
        sessionId: 'c999',
        providerSessionId: 'other-provider-session',
      },
      {
        id: 'c638',
        providerSessionId: '019e57c6-59bd-7c50-ae86-f92a5ddf624a',
      },
    ),
    false,
    'unrelated session_changed events must not wake the open chat',
  );
});
